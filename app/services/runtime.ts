import { randomUUID } from "node:crypto";
import {
  APP_TAGS,
  EVALUATION_VERSION,
  GRACE_PERIOD_DAYS,
  LABEL_NO_ISSUE,
  PROMPT_VERSION,
  QUEUE_PAGE_SIZE,
  STARTER_ORDER_CAP,
} from "../domain/constants";
import { canonicalContentHash } from "../domain/contentHash";
import { decryptJson } from "../domain/crypto";
import { evaluateOrder, withProviderRetry } from "../domain/evaluate";
import { verifyShopifyHmac } from "../domain/hmac";
import { reasonLabel } from "../domain/reasons";
import { applyReviewTransition, canMutateReview } from "../domain/review";
import { canConfigure, canReview, roleFromVerifiedStaff } from "../domain/roles";
import { validateMapping, validateRuleSet } from "../domain/rules";
import { buildSnapshot } from "../domain/snapshot";
import { desiredAppTags, outboxActionKey } from "../domain/tags";
import { canReserve } from "../domain/usage";
import type {
  AuthContext,
  DecisionProvider,
  JobRecord,
  OnboardingStep,
  OperatingMode,
  OrderSnapshot,
  OverallLabel,
  ProductMapping,
  ReasonCode,
  ResolveAction,
  RuleSet,
  ShopifyAdapter,
  ShopifyOrder,
  StaffRole,
} from "../domain/types";
import type { AdminGraphql } from "../integrations/shopify/admin";
import { FakeDecisionProvider } from "../integrations/jev/fake";
import { DemoShopifyAdapter } from "../integrations/shopify/demo";
import {
  MemoryStore,
  type FindingRow,
  type OrderRow,
  type ShopRow,
} from "../store/memory";

export type RuntimeConfig = {
  mode: "demo" | "live";
  shopifySecret: string;
  encryptionKey: string;
  allowTestAuth: boolean;
  demoLabel: boolean;
};

export class OrderClarityRuntime {
  store: MemoryStore;
  shopify: ShopifyAdapter;
  provider: DecisionProvider;
  config: RuntimeConfig;
  providerCalls = 0;
  webhookEnqueues = 0;
  lastRetryAttempts = 0;

  constructor(args?: {
    store?: MemoryStore;
    shopify?: ShopifyAdapter;
    provider?: DecisionProvider;
    config?: Partial<RuntimeConfig>;
  }) {
    this.store = args?.store ?? new MemoryStore();
    this.provider = args?.provider ?? new FakeDecisionProvider();
    this.config = {
      mode: "demo",
      shopifySecret: "demo-webhook-secret",
      encryptionKey: this.store.encryptionSecret,
      allowTestAuth: true,
      demoLabel: true,
      ...args?.config,
    };
    this.store.encryptionSecret = this.config.encryptionKey;
    if (this.config.mode === "live") {
      if (!args?.shopify || args.shopify.kind !== "live") {
        throw new Error("Live mode requires ShopifyAdminAdapter; refusing DemoShopifyAdapter");
      }
      this.shopify = args.shopify;
    } else {
      this.shopify = args?.shopify ?? new DemoShopifyAdapter();
    }
  }

  bindAdminGraphql: ((domain: string, graphql: AdminGraphql) => void) | null = null;

  async flush() {
    await this.store.flush();
  }

  async ensureTenantFromSession(session: {
    shop: string;
    accessToken?: string;
    userId?: string | number | bigint | null;
    accountOwner?: boolean;
    scope?: string | null;
  }): Promise<AuthContext> {
    const domain = session.shop;
    let shop = await this.store.getShopByDomain(domain);
    if (!shop) {
      shop = this.store.createShop({
        domain,
        mode: "observation",
        onboardingStep: "install",
        webhookSecret: this.config.shopifySecret,
      });
      await this.store.flush();
    } else if (shop.status === "uninstalled") {
      shop.installationGeneration += 1;
      shop.status = "active";
      shop.onboardingStep = "install";
      this.store.saveShop(shop);
      await this.store.flush();
    }
    const staffId =
      session.userId === undefined || session.userId === null ? null : String(session.userId);
    let user = staffId ? await this.store.getUser(shop.id, staffId) : null;
    if (staffId && !user && session.accountOwner) {
      const existingOwner = (await this.store.listUsers(shop.id)).find((u) => u.role === "owner" && u.active);
      if (!existingOwner) {
        user = this.store.createUser({
          shopId: shop.id,
          verifiedStaffId: staffId,
          role: "owner",
          active: true,
          displayName: "Account owner",
        });
        await this.store.flush();
      }
    }
    const role = roleFromVerifiedStaff({
      verifiedStaffId: staffId,
      recordedRole: user?.role ?? null,
      accountOwner: session.accountOwner,
    });
    return {
      shopId: shop.id,
      shopDomain: shop.domain,
      installationGeneration: shop.installationGeneration,
      staffId,
      role,
      requestId: this.requestId(),
    };
  }

  requestId(): string {
    return randomUUID();
  }

  async authenticate(headers: Headers, url: URL): Promise<AuthContext | { error: number; body: Record<string, unknown> }> {
    const requestId = headers.get("x-request-id") || this.requestId();
    if (this.config.allowTestAuth) {
      const raw = headers.get("x-ordercclarity-test-session") || headers.get("x-ordercclarity-session");
      const alt = headers.get("x-orderclarity-test-session");
      const session = raw || alt;
      if (session) {
        const parsed = JSON.parse(session) as {
          shopId: string;
          staffId: string | null;
          role?: StaffRole;
        };
        const shop = await this.store.getShop(parsed.shopId);
        if (!shop) return { error: 401, body: { error: "unauthenticated", requestId } };
        const user = parsed.staffId ? await this.store.getUser(shop.id, parsed.staffId) : null;
        const role = roleFromVerifiedStaff({
          verifiedStaffId: parsed.staffId,
          recordedRole: user?.role ?? parsed.role ?? null,
        });
        return {
          shopId: shop.id,
          shopDomain: shop.domain,
          installationGeneration: shop.installationGeneration,
          staffId: parsed.staffId,
          role,
          requestId,
        };
      }
    }
    const shopHeader = headers.get("x-demo-shop");
    if (this.config.mode === "demo") {
      const shop =
        (shopHeader ? await this.store.getShopByDomain(shopHeader) : null) ??
        (await this.store.getShopByDomain("demo-shop.example")) ??
        (await this.store.listShops())[0];
      if (!shop) return { error: 401, body: { error: "unauthenticated", requestId } };
      const owner = (await this.store.listUsers(shop.id)).find((u) => u.role === "owner");
      return {
        shopId: shop.id,
        shopDomain: shop.domain,
        installationGeneration: shop.installationGeneration,
        staffId: owner?.verifiedStaffId ?? "demo-owner",
        role: owner?.role ?? "owner",
        requestId,
      };
    }
    const clientShop = url.searchParams.get("shop_id");
    if (clientShop) {
      return { error: 401, body: { error: "unauthenticated", requestId, message: "shop_id is not accepted from the client" } };
    }
    return { error: 401, body: { error: "unauthenticated", requestId } };
  }

  async handleWebhook(rawBody: Buffer, headers: Headers): Promise<{ status: number; body: Record<string, unknown> }> {
    const secret = this.config.shopifySecret;
    const hmac = headers.get("x-shopify-hmac-sha256");
    if (!verifyShopifyHmac(rawBody, hmac, secret)) {
      return { status: 401, body: { error: "invalid_hmac" } };
    }
    if (rawBody.length > 1_000_000) {
      return { status: 413, body: { error: "payload_too_large" } };
    }
    const domain = headers.get("x-shopify-shop-domain") ?? "";
    const shop = await this.store.getShopByDomain(domain);
    if (!shop || shop.status === "uninstalled") {
      return { status: 200, body: { ok: true, ignored: true } };
    }
    const eventId = headers.get("x-shopify-event-id") || headers.get("x-shopify-webhook-id") || randomUUID();
    const topic = headers.get("x-shopify-topic") || "";
    const dup = await this.store.recordReceipt({
      shopId: shop.id,
      installationGeneration: shop.installationGeneration,
      eventId,
      topic,
      status: "received",
      receivedAt: this.store.now(),
    });
    if (dup.duplicate) {
      return { status: 200, body: { ok: true, duplicate: true } };
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      return { status: 400, body: { error: "invalid_json" } };
    }

    if (topic === "app/uninstalled") {
      await this.uninstall(shop.id);
      return { status: 200, body: { ok: true } };
    }
    if (topic === "customers/redact") {
      const orders = (payload.orders_to_redact as string[] | undefined) ?? [];
      await this.redactCustomer(shop.id, orders);
      return { status: 200, body: { ok: true } };
    }
    if (topic === "shop/redact") {
      await this.redactShop(shop.id);
      return { status: 200, body: { ok: true } };
    }
    if (topic === "customers/data_request") {
      this.store.addAudit({
        shopId: shop.id,
        actorStaffId: null,
        action: "customers_data_request",
        entityType: "shop",
        entityId: shop.id,
        revision: null,
        metadata: { requestId: eventId },
      });
      return { status: 200, body: { ok: true } };
    }

    const orderGid =
      (payload.admin_graphql_api_id as string) ||
      (typeof payload.id === "number" ? `gid://shopify/Order/${payload.id}` : (payload.id as string));
    if (!orderGid) return { status: 200, body: { ok: true, ignored: true } };

    const tags = (payload.tags as string) || "";
    const tagList = typeof tags === "string" ? tags.split(",").map((t) => t.trim()) : Array.isArray(tags) ? tags : [];
    const onlyAppTags = tagList.length > 0 && tagList.every((t) => (APP_TAGS as readonly string[]).includes(t) || t === "");
    const contentChanged = Boolean(payload.note) || Boolean(payload.line_items) || topic.startsWith("orders/");
    if (topic.includes("orders") && onlyAppTags && !payload.note && !payload.line_items) {
      return { status: 200, body: { ok: true, ignored: "app_tag_loop" } };
    }

    this.store.enqueueJob({
      type: "evaluate_order",
      shopId: shop.id,
      installationGeneration: shop.installationGeneration,
      orderGid,
      payload: { topic, contentChanged },
      runAfter: Date.now(),
      attempts: 0,
      leasedUntil: null,
      status: "queued",
    });
    this.webhookEnqueues += 1;
    await this.store.flush();
    return { status: 200, body: { ok: true, enqueued: true } };
  }

  async drain(max = 100): Promise<number> {
    await this.store.flush();
    await this.store.pullWork();
    let n = 0;
    for (let i = 0; i < max; i++) {
      const job = await this.store.nextJob();
      if (!job) break;
      await this.processJob(job);
      n += 1;
    }
    return n;
  }

  async processJob(job: JobRecord): Promise<void> {
    const shop = await this.store.getShop(job.shopId);
    if (!shop || shop.status === "uninstalled" || shop.installationGeneration !== job.installationGeneration) {
      job.status = "cancelled";
      this.store.saveJob(job);
      await this.store.flush();
      return;
    }
    if (job.type === "evaluate_order" && job.orderGid) {
      await this.evaluateFresh(shop, job.orderGid, job);
      job.status = "done";
      this.store.saveJob(job);
      await this.store.flush();
      return;
    }
    if (job.type === "tag_outbox") {
      await this.flushOutbox(shop);
      job.status = "done";
      this.store.saveJob(job);
      await this.store.flush();
      return;
    }
    job.status = "done";
    this.store.saveJob(job);
    await this.store.flush();
  }

  async evaluateFresh(shop: ShopRow, orderGid: string, job?: JobRecord): Promise<void> {
    const mapping = await this.store.activeMapping(shop.id);
    const rules = await this.store.activeRules(shop.id);
    if (!mapping || !rules) return;

    const remote = await this.shopify.fetchOrder(shop.id, orderGid);
    if (!remote) return;
    if (remote.cancelled) {
      const existing = await this.store.getOrder(shop.id, orderGid);
      if (existing) {
        existing.lifecycle = "cancelled";
        this.store.saveOrder(existing);
      }
      return;
    }

    const snapshot = buildSnapshot({
      shopId: shop.id,
      installationGeneration: shop.installationGeneration,
      order: remote,
      mapping,
      rules,
      selectedProductGids: shop.selectedProductGids,
    });
    const hash = canonicalContentHash({
      snapshot,
      mappingVersion: mapping.version,
      ruleVersion: rules.version,
      promptVersion: PROMPT_VERSION,
    });

    let order = await this.store.getOrder(shop.id, orderGid);
    if (!order) {
      order = {
        id: randomUUID(),
        shopId: shop.id,
        orderGid,
        displayNumber: snapshot.displayNumber,
        currentSnapshotId: null,
        currentEvaluationId: null,
        rowVersion: 1,
        processingState: "queued",
        overallLabel: null,
        uncheckedReason: null,
        humanReview: "not_reviewed",
        assignee: null,
        lastEvaluatedAt: null,
        contentHash: null,
        customerId: snapshot.customerId,
        lifecycle: "active",
        productSummary: snapshot.items.map((i) => i.title).join(", "),
        primaryReason: null,
        issueCount: 0,
        createdAt: this.store.now(),
        snapshotRevision: 0,
      };
      this.store.saveOrder(order);
    }

    if (order.contentHash === hash && order.processingState === "complete") {
      return;
    }

    const reserved = await this.store.withTx(async () => {
      const sub = await this.ensureSubscription(shop.id);
      const now = new Date();
      if (sub.status === "grace" && sub.graceUntil && now.toISOString() >= sub.graceUntil) {
        sub.status = "paused";
        this.store.saveSubscription(sub);
      }
      const usage = await this.store.listUsage(shop.id, sub.cycleId);
      const already = usage.some((u) => u.orderGid === orderGid && u.state === "completed");
      const reservedExisting = usage.find((u) => u.orderGid === orderGid && u.state === "reserved");
      if (already) return { kind: "already" as const, reservationId: null, sub };
      if (reservedExisting) return { kind: "reserved" as const, reservationId: reservedExisting.reservationId, sub };
      const consumed = usage.filter((u) => u.state === "completed").length;
      const held = usage.filter((u) => u.state === "reserved").length;
      const decision = canReserve(
        {
          shopId: shop.id,
          cycleId: sub.cycleId,
          entitlement: sub.entitlement,
          consumed,
          reserved: held,
          status: sub.status,
          graceUntil: sub.graceUntil,
        },
        false,
      );
      if (!decision.ok) return { kind: "limit" as const, reservationId: null, sub };
      const reservationId = randomUUID();
      this.store.saveUsage({
        id: randomUUID(),
        shopId: shop.id,
        cycleId: sub.cycleId,
        orderGid,
        reservationId,
        state: "reserved",
        completedAt: null,
      });
      return { kind: "reserved" as const, reservationId, sub };
    });

    if (reserved.kind === "limit") {
      await this.commitEvaluation(shop, order, snapshot, hash, {
        processingState: "complete",
        overallLabel: "unchecked",
        uncheckedReason: "unchecked_plan_limit",
        findings: [],
        checkResults: [],
        providerCalled: false,
        serializedInputChars: 0,
        relevantItemCount: snapshot.items.length,
      });
      return;
    }
    const already = reserved.kind === "already";
    const reservationId = reserved.reservationId;
    const sub = reserved.sub;

    this.providerCalls += 1;
    const retryingProvider: DecisionProvider = {
      id: this.provider.id,
      classify: async (input) => {
        return withProviderRetry(
          async () => {
            this.lastRetryAttempts += 1;
            return this.provider.classify(input);
          },
          { maxAttempts: 5, delaysMs: [0, 0, 0, 0, 0] },
        );
      },
    };

    const outcome = await evaluateOrder({ snapshot, rules, provider: retryingProvider });

    const latest = await this.shopify.fetchOrder(shop.id, orderGid);
    if (latest) {
      const latestSnap = buildSnapshot({
        shopId: shop.id,
        installationGeneration: shop.installationGeneration,
        order: latest,
        mapping,
        rules,
        selectedProductGids: shop.selectedProductGids,
      });
      const latestHash = canonicalContentHash({
        snapshot: latestSnap,
        mappingVersion: mapping.version,
        ruleVersion: rules.version,
        promptVersion: PROMPT_VERSION,
      });
      if (latestHash !== hash) {
        if (reservationId) {
          const row = await this.store.getUsageByReservation(reservationId);
          if (row && row.state === "reserved") {
            row.state = "released";
            this.store.saveUsage(row);
          }
        }
        this.store.enqueueJob({
          type: "evaluate_order",
          shopId: shop.id,
          installationGeneration: shop.installationGeneration,
          orderGid,
          payload: { superseded: true },
          runAfter: Date.now(),
          attempts: (job?.attempts ?? 0) + 1,
          leasedUntil: null,
          status: "queued",
        });
        return;
      }
    }

    await this.commitEvaluation(shop, order, snapshot, hash, outcome);

    const chargeable =
      outcome.overallLabel !== "unchecked" &&
      outcome.uncheckedReason !== "unchecked_unmapped" &&
      outcome.processingState === "complete" &&
      (outcome.overallLabel === "issues" || outcome.overallLabel === "no_issue_detected");
    const completeSupported =
      outcome.processingState === "complete" &&
      (outcome.overallLabel === "issues" || outcome.overallLabel === "no_issue_detected");

    if (reservationId) {
      const row = await this.store.getUsageByReservation(reservationId);
      if (row) {
        if (completeSupported && !already) {
          row.state = "completed";
          row.completedAt = this.store.now();
        } else if (!completeSupported) {
          row.state = "released";
        }
        this.store.saveUsage(row);
      }
    }

    if (shop.mode === "assisted_review") {
      await this.queueTags(shop, order, snapshot, outcome.overallLabel, outcome.findings.some((f) => !f.uncertain || true));
    }
    await this.store.flush();
  }

  private async commitEvaluation(
    shop: ShopRow,
    order: OrderRow,
    snapshot: OrderSnapshot,
    hash: string,
    outcome: Awaited<ReturnType<typeof evaluateOrder>>,
  ) {
    for (const finding of (await this.store.listFindings(shop.id, order.id)).filter(
      (f) => f.state === "open" || f.state === "awaiting_customer",
    )) {
      finding.state = "superseded";
      this.store.saveFinding(finding);
    }

    const revision = order.snapshotRevision + 1;
    const snap = this.store.putSnapshot({
      id: randomUUID(),
      shopId: shop.id,
      orderId: order.id,
      revision,
      sourceHash: hash,
      sourceUpdatedAt: snapshot.shopifyUpdatedAt,
      payload: snapshot,
    });
    const evaluationId = randomUUID();
    this.store.saveEvaluation({
      id: evaluationId,
      shopId: shop.id,
      snapshotId: snap.id,
      orderId: order.id,
      mappingVersion: snapshot.mappingVersion,
      ruleVersion: snapshot.ruleVersion,
      promptVersion: PROMPT_VERSION,
      evaluationVersion: EVALUATION_VERSION,
      provider: this.provider.id,
      model: outcome.providerModel ?? null,
      state: outcome.processingState,
      overallLabel: outcome.overallLabel,
      uncheckedReason: outcome.uncheckedReason ?? null,
      encryptedRequest: outcome.providerCalled ? this.store.encrypt({ snapshotId: snap.id }) : null,
      encryptedResponse: outcome.providerCalled ? this.store.encrypt({ checks: outcome.checkResults }) : null,
      current: true,
      createdAt: this.store.now(),
    });
    for (const ev of await this.store.listEvaluations(shop.id, order.id)) {
      if (ev.id !== evaluationId) {
        ev.current = false;
        this.store.saveEvaluation(ev);
      }
    }

    const openFindings: FindingRow[] = [];
    for (const draft of outcome.findings) {
      const finding: FindingRow = {
        id: randomUUID(),
        shopId: shop.id,
        evaluationId,
        orderId: order.id,
        fingerprint: draft.fingerprint,
        checkId: draft.checkId,
        reasonCode: draft.reasonCode,
        itemRef: draft.itemRef,
        sourceRefs: draft.sourceRefs,
        evidence: draft.evidence,
        method: draft.method,
        uncertain: draft.uncertain,
        templateId: draft.templateId,
        state: "open",
        humanReview: "not_reviewed",
        rowVersion: 1,
        winningProbability: draft.winningProbability,
        confidence: draft.confidence,
      };
      this.store.saveFinding(finding);
      openFindings.push(finding);
    }

    order.currentSnapshotId = snap.id;
    order.currentEvaluationId = evaluationId;
    order.snapshotRevision = revision;
    order.rowVersion += 1;
    order.processingState = outcome.processingState;
    order.overallLabel = outcome.overallLabel;
    order.uncheckedReason = outcome.uncheckedReason ?? null;
    order.lastEvaluatedAt = this.store.now();
    order.contentHash = hash;
    order.issueCount = openFindings.length;
    order.primaryReason = openFindings[0]?.reasonCode ?? outcome.uncheckedReason ?? null;
    order.productSummary = snapshot.items.map((i) => i.title).join(", ");
    order.displayNumber = snapshot.displayNumber;
    order.customerId = snapshot.customerId;
    this.store.saveOrder(order);
  }

  async queueTags(shop: ShopRow, order: OrderRow, snapshot: OrderSnapshot, label: OverallLabel, hasOpen: boolean) {
    const desired = desiredAppTags({ mode: shop.mode, overallLabel: label, hasOpenFindings: hasOpen });
    for (const tag of desired.add) {
      const key = outboxActionKey({
        shopId: shop.id,
        orderGid: order.orderGid,
        revision: order.snapshotRevision,
        actionType: "add",
        tag,
      });
      if (!(await this.store.getOutbox(key))) {
        this.store.saveOutbox({
          actionKey: key,
          shopId: shop.id,
          orderGid: order.orderGid,
          revision: order.snapshotRevision,
          actionType: "add",
          tag,
          state: "pending",
          attempts: 0,
          lastError: null,
        });
      }
    }
    for (const tag of desired.remove) {
      const key = outboxActionKey({
        shopId: shop.id,
        orderGid: order.orderGid,
        revision: order.snapshotRevision,
        actionType: "remove",
        tag,
      });
      if (!(await this.store.getOutbox(key))) {
        this.store.saveOutbox({
          actionKey: key,
          shopId: shop.id,
          orderGid: order.orderGid,
          revision: order.snapshotRevision,
          actionType: "remove",
          tag,
          state: "pending",
          attempts: 0,
          lastError: null,
        });
      }
    }
    this.store.enqueueJob({
      type: "tag_outbox",
      shopId: shop.id,
      installationGeneration: shop.installationGeneration,
      orderGid: order.orderGid,
      payload: {},
      runAfter: Date.now(),
      attempts: 0,
      leasedUntil: null,
      status: "queued",
    });
  }

  async flushOutbox(shop: ShopRow) {
    for (const row of await this.store.listOutbox(shop.id)) {
      if (row.state === "succeeded") continue;
      row.attempts += 1;
      const result =
        row.actionType === "add"
          ? await this.shopify.addTags(shop.id, row.orderGid, [row.tag])
          : await this.shopify.removeTags(shop.id, row.orderGid, [row.tag]);
      if (result.ok || result.error === "timeout_after_success") {
        row.state = "succeeded";
        row.lastError = result.ok ? null : result.error ?? null;
      } else {
        row.state = "failed";
        row.lastError = result.error ?? "unknown";
      }
      this.store.saveOutbox(row);
    }
  }

  async ensureSubscription(shopId: string) {
    let sub = await this.store.getSubscription(shopId);
    if (!sub) {
      const start = new Date();
      const end = new Date(start.getTime() + 30 * 24 * 3600 * 1000);
      sub = {
        shopId,
        providerId: "simulated",
        plan: "trial",
        entitlement: STARTER_ORDER_CAP,
        cycleId: `${shopId}:${start.toISOString().slice(0, 7)}`,
        cycleStart: start.toISOString(),
        cycleEnd: end.toISOString(),
        status: "trial",
        graceUntil: null,
        lastVerifiedAt: start.toISOString(),
      };
      this.store.saveSubscription(sub);
    }
    return sub;
  }

  async overview(auth: AuthContext) {
    const shop = await this.store.getShop(auth.shopId);
    if (!shop) return null;
    const orders = await this.store.listOrders(auth.shopId);
    const openIssues = orders.filter((o) => o.overallLabel === "issues" && o.issueCount > 0).length;
    const unchecked = orders.filter((o) => o.overallLabel === "unchecked" || o.overallLabel === "incomplete").length;
    const processing = orders.filter((o) => o.processingState === "queued" || o.processingState === "running").length;
    const sub = await this.ensureSubscription(auth.shopId);
    const consumed = (await this.store.listUsage(auth.shopId, sub.cycleId)).filter(
      (u) => u.state === "completed",
    ).length;
    return {
      demo: this.config.demoLabel || this.config.mode === "demo",
      label: this.config.mode === "demo" ? "Demo" : "Live",
      operatingMode: shop.mode,
      observation: shop.mode === "observation",
      onboardingStep: shop.onboardingStep,
      shopStatus: shop.status,
      syncHealthy: shop.status === "active",
      unresolvedIssues: openIssues,
      uncheckedOrders: unchecked,
      integrationFailures: unchecked,
      processingBacklog: processing,
      usage: {
        consumed,
        entitlement: sub.entitlement,
        cycleId: sub.cycleId,
        status: sub.status,
      },
      copy: { noIssue: LABEL_NO_ISSUE },
    };
  }

  async queue(auth: AuthContext, params: URLSearchParams) {
    const tab = params.get("tab") || "open";
    const cursor = params.get("cursor");
    const limit = Number(params.get("limit") || QUEUE_PAGE_SIZE);
    const q = (params.get("q") || "").toLowerCase();
    let rows = await this.store.listOrders(auth.shopId);
    if (q) {
      rows = rows.filter((o) => o.displayNumber.toLowerCase().includes(q) || o.productSummary.toLowerCase().includes(q));
    }
    const findings = await this.store.listFindings(auth.shopId);
    const open = rows.filter((o) => o.overallLabel === "issues" && o.issueCount > 0);
    const unchecked = rows.filter((o) => o.overallLabel === "unchecked" || o.overallLabel === "incomplete");
    const awaiting = rows.filter((f) => findings.some((x) => x.orderId === f.id && x.state === "awaiting_customer"));
    const resolved = rows.filter((o) => o.humanReview === "reviewed");
    const noIssue = rows.filter((o) => o.overallLabel === "no_issue_detected");

    let selected = open;
    if (tab === "unchecked") selected = unchecked;
    else if (tab === "awaiting_customer") selected = awaiting;
    else if (tab === "resolved") selected = resolved;
    else if (tab === "no_issue_detected") selected = noIssue;
    else if (tab === "all") selected = rows;

    selected.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const start = cursor ? selected.findIndex((r) => r.id === cursor) + 1 : 0;
    const page = selected.slice(start, start + limit);
    const next = page.length === limit ? page[page.length - 1]?.id : null;
    return {
      demo: this.config.mode === "demo",
      tab,
      counts: {
        open: open.length,
        unchecked: unchecked.length,
        awaiting_customer: awaiting.length,
        resolved: resolved.length,
        no_issue_detected: noIssue.length,
      },
      rows: await Promise.all(page.map((o) => this.serializeOrder(o))),
      nextCursor: next,
    };
  }

  async serializeOrder(o: OrderRow) {
    const snap = o.currentSnapshotId ? await this.store.getSnapshot(o.currentSnapshotId) : null;
    const originalNote = snap?.payload?.originalNote ?? "";
    return {
      id: o.id,
      orderGid: o.orderGid,
      displayNumber: o.displayNumber,
      productSummary: o.productSummary,
      primaryReason: o.primaryReason,
      primaryReasonLabel: o.primaryReason ? reasonLabel(o.primaryReason) : o.overallLabel === "no_issue_detected" ? LABEL_NO_ISSUE : "",
      issueCount: o.issueCount,
      reviewState: o.humanReview,
      processingState: o.processingState,
      overallLabel: o.overallLabel,
      age: o.createdAt,
      assignee: o.assignee,
      lastEvaluatedAt: o.lastEvaluatedAt,
      originalNote,
      rowVersion: o.rowVersion,
      evaluationId: o.currentEvaluationId,
    };
  }

  async orderDetail(auth: AuthContext, id: string) {
    const order = (await this.store.getOrderById(auth.shopId, id)) ?? (await this.store.getOrder(auth.shopId, id));
    if (!order) return null;
    const snap = order.currentSnapshotId ? await this.store.getSnapshot(order.currentSnapshotId) : null;
    const findings = await this.store.listFindings(auth.shopId, order.id);
    const events = await this.store.listReviewEvents(auth.shopId, order.id);
    return {
      demo: this.config.mode === "demo",
      order: await this.serializeOrder(order),
      snapshot: snap?.payload ?? null,
      findings: findings.map((f) => ({
        ...f,
        reasonLabel: reasonLabel(f.reasonCode),
        originalValues: f.evidence,
      })),
      reviewEvents: events,
      shopifyOrderUrl: `https://admin.shopify.com/store/demo/orders/${order.orderGid}`,
      disclaimer:
        "An app resolution note does not update the Shopify order, production file, or another app. Confirm required external changes before completing a conflict review.",
    };
  }

  async resolveFinding(
    auth: AuthContext,
    findingId: string,
    body: {
      action: ResolveAction;
      evaluationId: string;
      rowVersion: number;
      note?: string;
      resolutionCategory?: string;
      dismissReason?: string;
    },
  ) {
    if (!canMutateReview(auth.role) || !canReview(auth.role)) {
      return { status: 403, body: { error: "forbidden", requestId: auth.requestId } };
    }
    return this.store.withTx(async () => {
      const finding = await this.store.getFinding(auth.shopId, findingId);
      if (!finding) {
        return { status: 404, body: { error: "not_found", requestId: auth.requestId } };
      }
      const isConflict =
        finding.reasonCode === "variant_conflict" || finding.reasonCode === "personalization_conflict";
      const result = applyReviewTransition(
        {
          id: finding.id,
          shopId: finding.shopId,
          evaluationId: finding.evaluationId,
          orderId: finding.orderId,
          rowVersion: finding.rowVersion,
          state: finding.state,
          humanReview: finding.humanReview,
        },
        { ...body, isConflict },
      );
      if (!result.ok) {
        return { status: result.status, body: { error: result.error, requestId: auth.requestId } };
      }
      finding.state = result.next.state;
      finding.humanReview = result.next.humanReview;
      finding.rowVersion = result.next.rowVersion;
      this.store.saveFinding(finding);
      this.store.addReviewEvent({
        shopId: auth.shopId,
        findingId: finding.id,
        orderId: finding.orderId,
        actorStaffId: auth.staffId,
        action: body.action,
        note: body.note ?? null,
      });
      const order = await this.store.getOrderById(auth.shopId, finding.orderId);
      if (order && order.shopId === auth.shopId) {
        const open = (await this.store.listFindings(auth.shopId, order.id)).filter((f) => f.state === "open");
        order.issueCount = open.length;
        if (open.length === 0 && finding.state === "resolved") order.humanReview = "reviewed";
        order.rowVersion += 1;
        this.store.saveOrder(order);
      }
      await this.store.flush();
      return { status: 200, body: { ok: true, finding, requestId: auth.requestId } };
    });
  }

  async saveMapping(auth: AuthContext, body: ProductMapping) {
    if (!canConfigure(auth.role)) return { status: 403, body: { error: "forbidden" } };
    const issues = validateMapping(body);
    if (issues.length) return { status: 400, body: { error: "invalid_mapping", issues } };
    const version = body.version || `m${Date.now()}`;
    const mapping: ProductMapping = {
      ...body,
      id: body.id || randomUUID(),
      shopId: auth.shopId,
      version,
      status: "draft",
    };
    this.store.upsertMapping(mapping);
    const shop = await this.store.getShop(auth.shopId);
    if (shop) {
      shop.onboardingStep = "map_fields";
      shop.selectedProductGids = mapping.productGids.length ? mapping.productGids : shop.selectedProductGids;
      this.store.saveShop(shop);
    }
    await this.store.flush();
    return { status: 200, body: { mapping } };
  }

  async activateRules(auth: AuthContext, ruleId: string) {
    if (!canConfigure(auth.role)) return { status: 403, body: { error: "forbidden" } };
    const rules = await this.store.getRule(auth.shopId, ruleId);
    if (!rules) return { status: 404, body: { error: "not_found" } };
    const mapping = (await this.store.activeMapping(auth.shopId)) ?? (await this.store.listMappings(auth.shopId))[0];
    const issues = validateRuleSet(rules, mapping ?? undefined);
    if (issues.length) return { status: 400, body: { error: "conflicting_rules", issues } };
    if (rules.status === "active") {
      return { status: 409, body: { error: "immutable_active_version", message: "Activate a new version instead." } };
    }
    for (const r of await this.store.listRules(auth.shopId)) {
      if (r.scope === rules.scope && r.status === "active" && r.id !== rules.id) {
        r.status = "superseded";
        this.store.upsertRules(r);
      }
    }
    rules.status = "active";
    this.store.upsertRules(rules);
    if (mapping) {
      mapping.status = "active";
      this.store.upsertMapping(mapping);
    }
    const shop = await this.store.getShop(auth.shopId);
    if (shop) {
      shop.onboardingStep = "review_sample";
      this.store.saveShop(shop);
    }
    this.store.addAudit({
      shopId: auth.shopId,
      actorStaffId: auth.staffId,
      action: "rules_activated",
      entityType: "ruleset",
      entityId: rules.id,
      revision: Number(rules.version.replace(/\D/g, "") || 1),
      metadata: { version: rules.version },
    });
    for (const order of await this.store.listOrders(auth.shopId)) {
      if (order.lifecycle === "active") {
        this.store.enqueueJob({
          type: "evaluate_order",
          shopId: auth.shopId,
          installationGeneration: shop?.installationGeneration ?? 1,
          orderGid: order.orderGid,
          payload: { reason: "rule_activation" },
          runAfter: Date.now(),
          attempts: 0,
          leasedUntil: null,
          status: "queued",
        });
      }
    }
    await this.store.flush();
    return { status: 200, body: { rules } };
  }

  async setMode(auth: AuthContext, mode: OperatingMode, confirmedTags?: string[]) {
    if (!canConfigure(auth.role)) return { status: 403, body: { error: "forbidden" } };
    const shop = await this.store.getShop(auth.shopId);
    if (!shop) return { status: 404, body: { error: "not_found" } };
    if (mode === "assisted_review") {
      const expected = [...APP_TAGS];
      const ok =
        confirmedTags &&
        confirmedTags.length === expected.length &&
        expected.every((t) => confirmedTags.includes(t));
      if (!ok) {
        return {
          status: 400,
          body: {
            error: "confirmation_required",
            tags: expected,
            message: "Owner must confirm the tags that will be written.",
          },
        };
      }
    }
    shop.mode = mode;
    this.store.saveShop(shop);
    this.store.addAudit({
      shopId: auth.shopId,
      actorStaffId: auth.staffId,
      action: "mode_changed",
      entityType: "shop",
      entityId: shop.id,
      revision: shop.installationGeneration,
      metadata: { mode },
    });
    return { status: 200, body: { mode } };
  }

  async uninstall(shopId: string) {
    const shop = await this.store.getShop(shopId);
    if (!shop) return;
    shop.status = "uninstalled";
    this.store.saveShop(shop);
    for (const job of await this.store.listJobs(shopId)) {
      if (job.shopId === shopId && job.status === "queued") {
        job.status = "cancelled";
        this.store.saveJob(job);
      }
    }
    this.store.addAudit({
      shopId,
      actorStaffId: null,
      action: "uninstalled",
      entityType: "shop",
      entityId: shopId,
      revision: shop.installationGeneration,
      metadata: {},
    });
  }

  async redactCustomer(shopId: string, orderGids: string[]) {
    const all = await this.store.listOrders(shopId);
    const targets = orderGids.length > 0 ? all.filter((o) => orderGids.includes(o.orderGid)) : all;
    for (const order of targets) {
      order.lifecycle = "redacted";
      order.customerId = null;
      this.store.saveOrder(order);
      for (const snap of await this.store.listSnapshots(shopId)) {
        if (snap.orderId === order.id) {
          snap.payload = null;
          snap.encryptedPayload = null;
          this.store.putSnapshot(snap);
        }
      }
      for (const ev of await this.store.listEvaluations(shopId, order.id)) {
        ev.encryptedRequest = null;
        ev.encryptedResponse = null;
        this.store.saveEvaluation(ev);
      }
      for (const f of await this.store.listFindings(shopId, order.id)) {
        f.evidence = {};
        this.store.saveFinding(f);
      }
    }
    await this.store.flush();
  }

  async redactShop(shopId: string) {
    await this.redactCustomer(shopId, []);
  }

  async usage(auth: AuthContext) {
    const sub = await this.ensureSubscription(auth.shopId);
    const consumed = (await this.store.listUsage(auth.shopId, sub.cycleId)).filter(
      (u) => u.state === "completed",
    ).length;
    return {
      plan: sub.plan,
      entitlement: sub.entitlement,
      consumed,
      cycleStart: sub.cycleStart,
      cycleEnd: sub.cycleEnd,
      status: sub.status,
      graceUntil: sub.graceUntil,
      demo: this.config.mode === "demo",
    };
  }

  async startGrace(shopId: string, from = new Date()) {
    const sub = await this.ensureSubscription(shopId);
    const until = new Date(from.getTime() + GRACE_PERIOD_DAYS * 24 * 3600 * 1000);
    sub.status = "grace";
    sub.graceUntil = until.toISOString();
    this.store.saveSubscription(sub);
    this.store.addAudit({
      shopId,
      actorStaffId: null,
      action: "billing_grace_started",
      entityType: "subscription",
      entityId: shopId,
      revision: null,
      metadata: { graceUntil: sub.graceUntil },
    });
    return sub;
  }

  async expireGrace(shopId: string) {
    const sub = await this.ensureSubscription(shopId);
    sub.status = "paused";
    this.store.saveSubscription(sub);
    return sub;
  }

  seedShopifyOrder(order: ShopifyOrder) {
    if (this.shopify instanceof DemoShopifyAdapter) {
      this.shopify.seed(order);
    }
  }

  async getOnboarding(auth: AuthContext) {
    const shop = await this.store.getShop(auth.shopId);
    const orders = (await this.store.listOrders(auth.shopId)).slice(0, 20);
    return {
      step: shop?.onboardingStep ?? "install",
      steps: ["install", "choose_products", "map_fields", "define_rules", "review_sample", "activate"] as OnboardingStep[],
      productGids: shop?.selectedProductGids ?? [],
      collectionGid: shop?.collectionGid ?? null,
      collectionNeedsReview: shop?.collectionNeedsReview ?? false,
      mappings: await this.store.listMappings(auth.shopId),
      rules: await this.store.listRules(auth.shopId),
      sampleOrders: await Promise.all(orders.map((o) => this.serializeOrder(o))),
      demo: this.config.mode === "demo",
    };
  }

  async chooseProducts(
    auth: AuthContext,
    body: { productGids?: string[]; collectionGid?: string | null },
  ) {
    if (!canConfigure(auth.role)) return { status: 403, body: { error: "forbidden" } };
    const gids = body.productGids ?? [];
    if (gids.length === 0 && !body.collectionGid) {
      return { status: 400, body: { error: "product_selection_required" } };
    }
    const shop = await this.store.getShop(auth.shopId);
    if (!shop) return { status: 404, body: { error: "not_found" } };
    shop.selectedProductGids = gids;
    shop.collectionGid = body.collectionGid ?? null;
    shop.collectionNeedsReview = false;
    shop.onboardingStep = "map_fields";
    shop.onboarding = { ...shop.onboarding, productGids: gids };
    this.store.saveShop(shop);
    await this.store.flush();
    return { status: 200, body: { productGids: gids, collectionGid: shop.collectionGid, step: shop.onboardingStep } };
  }

  async saveRuleDraft(auth: AuthContext, body: Partial<RuleSet>) {
    if (!canConfigure(auth.role)) return { status: 403, body: { error: "forbidden" } };
    const rules: RuleSet = {
      id: body.id || randomUUID(),
      shopId: auth.shopId,
      scope: body.scope || "engraved-gifts",
      version: body.version || String(Date.now()),
      status: "draft",
      requiredRoles: body.requiredRoles ?? ["engraving"],
      maxGraphemes: body.maxGraphemes === undefined ? 20 : body.maxGraphemes,
      allowedOptions: body.allowedOptions ?? {},
      surfaces: body.surfaces === undefined ? ["front"] : body.surfaces,
      handleOrderNotes: body.handleOrderNotes ?? "gift_unless_instruction",
      productOverrides: body.productOverrides ?? {},
      thresholds: body.thresholds ?? { winProb: 0.9, confidence: 0.8 },
      createdAt: this.store.now(),
    };
    const mapping = (await this.store.listMappings(auth.shopId))[0];
    const issues = validateRuleSet(rules, mapping);
    if (issues.length) return { status: 400, body: { error: "conflicting_rules", issues } };
    this.store.upsertRules(rules);
    const shop = await this.store.getShop(auth.shopId);
    if (shop) {
      shop.onboardingStep = "define_rules";
      this.store.saveShop(shop);
    }
    await this.store.flush();
    return { status: 200, body: { rules } };
  }

  async previewRules(auth: AuthContext, ruleId: string, opts?: { orderGid?: string }) {
    if (!canConfigure(auth.role)) return { status: 403, body: { error: "forbidden" } };
    const rules = await this.store.getRule(auth.shopId, ruleId);
    if (!rules) return { status: 404, body: { error: "not_found" } };
    const mapping =
      (await this.store.activeMapping(auth.shopId)) ?? (await this.store.listMappings(auth.shopId))[0];
    if (!mapping) return { status: 400, body: { error: "mapping_required" } };
    const shop = await this.store.getShop(auth.shopId);
    if (!shop) return { status: 404, body: { error: "not_found" } };
    const outboxBefore = (await this.store.listOutbox(auth.shopId)).length;
    const statusBefore = rules.status;
    let snapshot: OrderSnapshot | null = null;
    if (opts?.orderGid) {
      const remote = await this.shopify.fetchOrder(auth.shopId, opts.orderGid);
      if (remote) {
        snapshot = buildSnapshot({
          shopId: auth.shopId,
          installationGeneration: shop.installationGeneration,
          order: remote,
          mapping,
          rules,
          selectedProductGids: shop.selectedProductGids,
        });
      }
    }
    if (!snapshot) {
      const existing = (await this.store.listOrders(auth.shopId))[0];
      const prior = existing?.currentSnapshotId ? await this.store.getSnapshot(existing.currentSnapshotId) : null;
      if (prior?.payload) {
        snapshot = { ...prior.payload, ruleVersion: rules.version, mappingVersion: mapping.version };
      }
    }
    if (!snapshot) {
      snapshot = buildSnapshot({
        shopId: auth.shopId,
        installationGeneration: shop.installationGeneration,
        mapping,
        rules,
        selectedProductGids: mapping.productGids,
        order: {
          orderGid: "gid://shopify/Order/preview-synthetic",
          displayNumber: "#preview-synthetic",
          updatedAt: this.store.now(),
          cancelled: false,
          note: "Please make it silver instead of the gold finish.",
          tags: [],
          customerId: null,
          fulfillmentSummary: "UNFULFILLED",
          paginationComplete: true,
          lineItems: [
            {
              lineItemGid: "gid://shopify/LineItem/preview",
              productGid: mapping.productGids[0] || "gid://shopify/Product/preview",
              variantGid: "gid://shopify/ProductVariant/preview",
              title: "Sample engraved bracelet",
              quantity: 1,
              selectedOptions: { finish: "gold" },
              customAttributes: [{ key: "Engraving", value: "Alex" }],
            },
          ],
        },
      });
    }
    const outcome = await evaluateOrder({ snapshot, rules, provider: this.provider });
    if (shop.onboardingStep === "define_rules" || shop.onboardingStep === "map_fields") {
      shop.onboardingStep = "review_sample";
      this.store.saveShop(shop);
      await this.store.flush();
    }
    return {
      status: 200,
      body: {
        preview: true,
        activated: false,
        tagsWritten: false,
        rulesStatus: statusBefore,
        stillDraft: statusBefore !== "active",
        outboxUnchanged: (await this.store.listOutbox(auth.shopId)).length === outboxBefore,
        overallLabel: outcome.overallLabel,
        findings: outcome.findings,
        originalNote: snapshot.originalNote,
        providerCalled: outcome.providerCalled,
        checkResults: outcome.checkResults.map((c) => ({
          checkId: c.checkId,
          outcome: c.outcome,
          reasonCode: c.reasonCode,
        })),
      },
    };
  }

  async completeOnboarding(auth: AuthContext) {
    if (!canConfigure(auth.role)) return { status: 403, body: { error: "forbidden" } };
    const mapping = await this.store.activeMapping(auth.shopId);
    const rules = await this.store.activeRules(auth.shopId);
    if (!mapping || !rules) {
      return { status: 400, body: { error: "mapping_and_rules_required" } };
    }
    const shop = await this.store.getShop(auth.shopId);
    if (!shop) return { status: 404, body: { error: "not_found" } };
    shop.onboardingStep = "activate";
    this.store.saveShop(shop);
    await this.store.flush();
    return { status: 200, body: { step: "activate" } };
  }
}

export function isAuthContext(value: AuthContext | { error: number; body: Record<string, unknown> }): value is AuthContext {
  return (value as AuthContext).shopId !== undefined && (value as { error?: number }).error === undefined;
}
