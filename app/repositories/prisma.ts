/**
 * Tenant-scoped PostgreSQL persistence used when APP_MODE=live.
 * Demo/tests may inject createMemoryPrisma() so writes are asserted without a live cluster.
 */
import { decryptJson } from "../domain/crypto";
import type { JobRecord } from "../domain/types";
import {
  MemoryStore,
  type AppUserRow,
  type AuditEventRow,
  type EvaluationRow,
  type FindingRow,
  type MappingRow,
  type OrderRow,
  type OutboxRow,
  type ReviewEventRow,
  type RuleRow,
  type ShopRow,
  type SnapshotRow,
  type SubscriptionRow,
  type UsageLedgerRow,
  type WebhookReceiptRow,
} from "../store/memory";

export type PrismaLike = {
  shop: Model<ShopRecord>;
  appUser: Model<UserRecord>;
  productMapping: Model<MappingRecord>;
  ruleSet: Model<RuleRecord>;
  orderRecord: Model<OrderRecord>;
  orderSnapshot: Model<SnapshotRecord>;
  evaluation: Model<EvaluationRecord>;
  finding: Model<FindingRecord>;
  usageLedger: Model<UsageRecord>;
  actionOutbox: Model<OutboxRecord>;
  subscription: Model<SubRecord>;
  job: Model<JobDbRecord>;
  webhookReceipt: Model<ReceiptRecord>;
  reviewEvent: Model<ReviewDbRecord>;
  auditEvent: Model<AuditDbRecord>;
  installation: Model<InstallRecord>;
};

type Model<T> = {
  findMany: (args?: { where?: Record<string, unknown> }) => Promise<T[]>;
  findUnique: (args: { where: Record<string, unknown> }) => Promise<T | null>;
  upsert: (args: { where: Record<string, unknown>; create: T; update: Partial<T> }) => Promise<T>;
  create: (args: { data: T }) => Promise<T>;
};

type ShopRecord = {
  id: string;
  domain: string;
  installationGeneration: number;
  mode: string;
  timezone: string;
  status: string;
  onboardingStep: string;
  onboardingJson: string;
  selectedProductGidsJson: string;
  collectionGid: string | null;
  collectionNeedsReview: boolean;
};
type UserRecord = {
  id: string;
  shopId: string;
  verifiedStaffId: string;
  role: string;
  active: boolean;
  displayName: string;
};
type MappingRecord = {
  id: string;
  shopId: string;
  scope: string;
  version: string;
  status: string;
  productGidsJson: string;
  collectionGid: string | null;
  entriesJson: string;
  createdAt: Date;
};
type RuleRecord = {
  id: string;
  shopId: string;
  scope: string;
  version: string;
  status: string;
  policyJson: string;
  createdAt: Date;
};
type OrderRecord = {
  id: string;
  shopId: string;
  orderGid: string;
  currentSnapshotId: string | null;
  currentEvaluationId: string | null;
  rowVersion: number;
  processingState: string;
  overallLabel: string | null;
  uncheckedReason: string | null;
  humanReview: string;
  assignee: string | null;
  lastEvaluatedAt: Date | null;
  contentHash: string | null;
  customerId: string | null;
  lifecycle: string;
  displayNumber: string;
  productSummary: string;
  primaryReason: string | null;
  issueCount: number;
  snapshotRevision: number;
  createdAt: Date;
};
type SnapshotRecord = {
  id: string;
  shopId: string;
  orderId: string;
  revision: number;
  sourceHash: string;
  sourceUpdatedAt: Date;
  encryptedPayload: string | null;
};
type EvaluationRecord = {
  id: string;
  shopId: string;
  snapshotId: string;
  orderId: string;
  mappingVersion: string;
  ruleVersion: string;
  promptVersion: string;
  evaluationVersion: string;
  provider: string;
  model: string | null;
  state: string;
  overallLabel: string;
  uncheckedReason: string | null;
  encryptedRequest: string | null;
  encryptedResponse: string | null;
  current: boolean;
  createdAt: Date;
};
type FindingRecord = {
  id: string;
  shopId: string;
  evaluationId: string;
  orderId: string;
  fingerprint: string;
  checkId: string;
  reasonCode: string;
  itemRef: string | null;
  sourceRefsJson: string;
  evidenceJson: string;
  method: string;
  uncertain: boolean;
  templateId: string;
  state: string;
  humanReview: string;
  rowVersion: number;
  winningProbability: number | null;
  confidence: number | null;
};
type UsageRecord = {
  id: string;
  shopId: string;
  cycleId: string;
  orderGid: string;
  reservationId: string;
  state: string;
  completedAt: Date | null;
};
type OutboxRecord = {
  actionKey: string;
  shopId: string;
  orderGid: string;
  revision: number;
  actionType: string;
  tag: string;
  state: string;
  attempts: number;
  lastError: string | null;
};
type SubRecord = {
  shopId: string;
  providerId: string;
  plan: string;
  entitlement: number;
  cycleId: string;
  cycleStart: Date;
  cycleEnd: Date;
  status: string;
  graceUntil: Date | null;
  lastVerifiedAt: Date | null;
};
type JobDbRecord = {
  id: string;
  type: string;
  shopId: string;
  installationGeneration: number;
  orderGid: string | null;
  payloadJson: string;
  runAfter: bigint;
  attempts: number;
  leasedUntil: bigint | null;
  status: string;
};
type ReceiptRecord = {
  shopId: string;
  installationGeneration: number;
  eventId: string;
  topic: string;
  status: string;
  receivedAt: Date;
};
type ReviewDbRecord = {
  id: string;
  shopId: string;
  findingId: string | null;
  orderId: string;
  actorStaffId: string | null;
  action: string;
  note: string | null;
  timestamp: Date;
};
type AuditDbRecord = {
  id: string;
  shopId: string;
  actorStaffId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  revision: number | null;
  metadataJson: string;
  timestamp: Date;
};
type InstallRecord = {
  id: string;
  shopId: string;
  generation: number;
  encryptedToken: string;
  scopes: string;
  installedAt: Date;
  revokedAt: Date | null;
};

function table<T extends Record<string, unknown>>(key: (row: T) => string) {
  const rows = new Map<string, T>();
  const matches = (row: T, where?: Record<string, unknown>) => {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
  };
  return {
    rows,
    findMany: async (args?: { where?: Record<string, unknown> }) =>
      [...rows.values()].filter((r) => matches(r, args?.where)),
    findUnique: async (args: { where: Record<string, unknown> }) =>
      [...rows.values()].find((r) => matches(r, args.where)) ?? null,
    upsert: async (args: { where: Record<string, unknown>; create: T; update: Partial<T> }) => {
      const existing = [...rows.values()].find((r) => matches(r, args.where));
      if (!existing) {
        rows.set(key(args.create), args.create);
        return args.create;
      }
      const merged = { ...existing, ...args.update } as T;
      rows.set(key(merged), merged);
      return merged;
    },
    create: async (args: { data: T }) => {
      const k = key(args.data);
      if (rows.has(k)) {
        const err = new Error("Unique constraint failed");
        (err as { code?: string }).code = "P2002";
        throw err;
      }
      rows.set(k, args.data);
      return args.data;
    },
  };
}

export function createMemoryPrisma(): PrismaLike {
  return {
    shop: table((r: ShopRecord) => r.id),
    appUser: table((r: UserRecord) => r.id),
    productMapping: table((r: MappingRecord) => r.id),
    ruleSet: table((r: RuleRecord) => r.id),
    orderRecord: table((r: OrderRecord) => r.id),
    orderSnapshot: table((r: SnapshotRecord) => r.id),
    evaluation: table((r: EvaluationRecord) => r.id),
    finding: table((r: FindingRecord) => r.id),
    usageLedger: table((r: UsageRecord) => r.id),
    actionOutbox: table((r: OutboxRecord) => r.actionKey),
    subscription: table((r: SubRecord) => r.shopId),
    job: table((r: JobDbRecord) => r.id),
    webhookReceipt: table((r: ReceiptRecord) => `${r.shopId}:${r.installationGeneration}:${r.eventId}`),
    reviewEvent: table((r: ReviewDbRecord) => r.id),
    auditEvent: table((r: AuditDbRecord) => r.id),
    installation: table((r: InstallRecord) => r.id),
  };
}

export class PrismaStore extends MemoryStore {
  skippingPersist = false;

  constructor(
    private readonly prisma: PrismaLike,
    encryptionKey: string,
  ) {
    super();
    this.encryptionSecret = encryptionKey;
  }

  async hydrate(): Promise<void> {
    this.skippingPersist = true;
    const shops = await this.prisma.shop.findMany();
    for (const s of shops) {
      this.shops.set(s.id, {
        id: s.id,
        domain: s.domain,
        installationGeneration: s.installationGeneration,
        mode: s.mode as ShopRow["mode"],
        timezone: s.timezone,
        status: s.status as ShopRow["status"],
        onboardingStep: s.onboardingStep as ShopRow["onboardingStep"],
        onboarding: JSON.parse(s.onboardingJson || "{}"),
        selectedProductGids: JSON.parse(s.selectedProductGidsJson || "[]"),
        collectionGid: s.collectionGid,
        collectionNeedsReview: s.collectionNeedsReview,
        webhookSecret: "",
      });
      this.shopsByDomain.set(s.domain, s.id);
    }
    for (const u of await this.prisma.appUser.findMany()) {
      this.users.set(u.id, {
        id: u.id,
        shopId: u.shopId,
        verifiedStaffId: u.verifiedStaffId,
        role: u.role as AppUserRow["role"],
        active: u.active,
        displayName: u.displayName,
      });
    }
    for (const m of await this.prisma.productMapping.findMany()) {
      this.mappings.push({
        id: m.id,
        shopId: m.shopId,
        scope: m.scope,
        version: m.version,
        status: m.status as MappingRow["status"],
        productGids: JSON.parse(m.productGidsJson),
        collectionGid: m.collectionGid,
        entries: JSON.parse(m.entriesJson),
        createdAt: m.createdAt.toISOString(),
      });
    }
    for (const r of await this.prisma.ruleSet.findMany()) {
      const policy = JSON.parse(r.policyJson) as Omit<RuleRow, "id" | "shopId" | "scope" | "version" | "status" | "createdAt">;
      this.rules.push({
        id: r.id,
        shopId: r.shopId,
        scope: r.scope,
        version: r.version,
        status: r.status as RuleRow["status"],
        createdAt: r.createdAt.toISOString(),
        ...policy,
      });
    }
    for (const o of await this.prisma.orderRecord.findMany()) {
      this.orders.set(o.id, {
        id: o.id,
        shopId: o.shopId,
        orderGid: o.orderGid,
        displayNumber: o.displayNumber || o.orderGid,
        currentSnapshotId: o.currentSnapshotId,
        currentEvaluationId: o.currentEvaluationId,
        rowVersion: o.rowVersion,
        processingState: o.processingState as OrderRow["processingState"],
        overallLabel: o.overallLabel as OrderRow["overallLabel"],
        uncheckedReason: o.uncheckedReason as OrderRow["uncheckedReason"],
        humanReview: o.humanReview as OrderRow["humanReview"],
        assignee: o.assignee,
        lastEvaluatedAt: o.lastEvaluatedAt?.toISOString() ?? null,
        contentHash: o.contentHash,
        customerId: o.customerId,
        lifecycle: o.lifecycle as OrderRow["lifecycle"],
        productSummary: o.productSummary,
        primaryReason: o.primaryReason as OrderRow["primaryReason"],
        issueCount: o.issueCount,
        createdAt: o.createdAt.toISOString(),
        snapshotRevision: o.snapshotRevision,
      });
    }
    for (const s of await this.prisma.orderSnapshot.findMany()) {
      this.snapshots.set(s.id, {
        id: s.id,
        shopId: s.shopId,
        orderId: s.orderId,
        revision: s.revision,
        sourceHash: s.sourceHash,
        sourceUpdatedAt: s.sourceUpdatedAt.toISOString(),
        encryptedPayload: s.encryptedPayload,
        payload: s.encryptedPayload ? decryptJson(s.encryptedPayload, this.encryptionSecret) : null,
      });
    }
    for (const e of await this.prisma.evaluation.findMany()) {
      this.evaluations.set(e.id, {
        id: e.id,
        shopId: e.shopId,
        snapshotId: e.snapshotId,
        orderId: e.orderId,
        mappingVersion: e.mappingVersion,
        ruleVersion: e.ruleVersion,
        promptVersion: e.promptVersion,
        evaluationVersion: e.evaluationVersion,
        provider: e.provider,
        model: e.model,
        state: e.state as EvaluationRow["state"],
        overallLabel: e.overallLabel as EvaluationRow["overallLabel"],
        uncheckedReason: e.uncheckedReason as EvaluationRow["uncheckedReason"],
        encryptedRequest: e.encryptedRequest,
        encryptedResponse: e.encryptedResponse,
        current: e.current,
        createdAt: e.createdAt.toISOString(),
      });
    }
    for (const f of await this.prisma.finding.findMany()) {
      this.findings.set(f.id, {
        id: f.id,
        shopId: f.shopId,
        evaluationId: f.evaluationId,
        orderId: f.orderId,
        fingerprint: f.fingerprint,
        checkId: f.checkId,
        reasonCode: f.reasonCode as FindingRow["reasonCode"],
        itemRef: f.itemRef,
        sourceRefs: JSON.parse(f.sourceRefsJson),
        evidence: JSON.parse(f.evidenceJson),
        method: f.method,
        uncertain: f.uncertain,
        templateId: f.templateId,
        state: f.state as FindingRow["state"],
        humanReview: f.humanReview as FindingRow["humanReview"],
        rowVersion: f.rowVersion,
        winningProbability: f.winningProbability ?? undefined,
        confidence: f.confidence ?? undefined,
      });
    }
    this.usage = (await this.prisma.usageLedger.findMany()).map((u) => ({
      id: u.id,
      shopId: u.shopId,
      cycleId: u.cycleId,
      orderGid: u.orderGid,
      reservationId: u.reservationId,
      state: u.state as UsageLedgerRow["state"],
      completedAt: u.completedAt?.toISOString() ?? null,
    }));
    for (const o of await this.prisma.actionOutbox.findMany()) {
      this.outbox.set(o.actionKey, {
        actionKey: o.actionKey,
        shopId: o.shopId,
        orderGid: o.orderGid,
        revision: o.revision,
        actionType: o.actionType as OutboxRow["actionType"],
        tag: o.tag,
        state: o.state as OutboxRow["state"],
        attempts: o.attempts,
        lastError: o.lastError,
      });
    }
    for (const s of await this.prisma.subscription.findMany()) {
      this.subscriptions.set(s.shopId, {
        shopId: s.shopId,
        providerId: s.providerId,
        plan: s.plan as SubscriptionRow["plan"],
        entitlement: s.entitlement,
        cycleId: s.cycleId,
        cycleStart: s.cycleStart.toISOString(),
        cycleEnd: s.cycleEnd.toISOString(),
        status: s.status as SubscriptionRow["status"],
        graceUntil: s.graceUntil?.toISOString() ?? null,
        lastVerifiedAt: s.lastVerifiedAt?.toISOString() ?? null,
      });
    }
    this.jobs = (await this.prisma.job.findMany()).map((j) => ({
      id: j.id,
      type: j.type as JobRecord["type"],
      shopId: j.shopId,
      installationGeneration: j.installationGeneration,
      orderGid: j.orderGid ?? undefined,
      payload: JSON.parse(j.payloadJson || "{}"),
      runAfter: Number(j.runAfter),
      attempts: j.attempts,
      leasedUntil: j.leasedUntil === null ? null : Number(j.leasedUntil),
      status: j.status as JobRecord["status"],
    }));
    this.skippingPersist = false;
  }

  protected queuePersist(fn: () => Promise<void> | void) {
    if (this.skippingPersist) return;
    super.queuePersist(fn);
  }

  protected async persistShop(shop: ShopRow) {
    const data: ShopRecord = {
      id: shop.id,
      domain: shop.domain,
      installationGeneration: shop.installationGeneration,
      mode: shop.mode,
      timezone: shop.timezone,
      status: shop.status,
      onboardingStep: shop.onboardingStep,
      onboardingJson: JSON.stringify(shop.onboarding),
      selectedProductGidsJson: JSON.stringify(shop.selectedProductGids),
      collectionGid: shop.collectionGid,
      collectionNeedsReview: shop.collectionNeedsReview,
    };
    await this.prisma.shop.upsert({ where: { id: shop.id }, create: data, update: data });
  }

  protected async persistUser(user: AppUserRow) {
    const data: UserRecord = {
      id: user.id,
      shopId: user.shopId,
      verifiedStaffId: user.verifiedStaffId,
      role: user.role,
      active: user.active,
      displayName: user.displayName,
    };
    await this.prisma.appUser.upsert({ where: { id: user.id }, create: data, update: data });
  }

  protected async persistMapping(mapping: MappingRow) {
    const data: MappingRecord = {
      id: mapping.id,
      shopId: mapping.shopId,
      scope: mapping.scope,
      version: mapping.version,
      status: mapping.status,
      productGidsJson: JSON.stringify(mapping.productGids),
      collectionGid: mapping.collectionGid,
      entriesJson: JSON.stringify(mapping.entries),
      createdAt: new Date(mapping.createdAt),
    };
    await this.prisma.productMapping.upsert({ where: { id: mapping.id }, create: data, update: data });
  }

  protected async persistRules(rules: RuleRow) {
    const { id, shopId, scope, version, status, createdAt, ...policy } = rules;
    const data: RuleRecord = {
      id,
      shopId,
      scope,
      version,
      status,
      policyJson: JSON.stringify(policy),
      createdAt: new Date(createdAt),
    };
    await this.prisma.ruleSet.upsert({ where: { id }, create: data, update: data });
  }

  protected async persistOrder(order: OrderRow) {
    const data: OrderRecord = {
      id: order.id,
      shopId: order.shopId,
      orderGid: order.orderGid,
      currentSnapshotId: order.currentSnapshotId,
      currentEvaluationId: order.currentEvaluationId,
      rowVersion: order.rowVersion,
      processingState: order.processingState,
      overallLabel: order.overallLabel,
      uncheckedReason: order.uncheckedReason,
      humanReview: order.humanReview,
      assignee: order.assignee,
      lastEvaluatedAt: order.lastEvaluatedAt ? new Date(order.lastEvaluatedAt) : null,
      contentHash: order.contentHash,
      customerId: order.customerId,
      displayNumber: order.displayNumber,
      lifecycle: order.lifecycle,
      productSummary: order.productSummary,
      primaryReason: order.primaryReason,
      issueCount: order.issueCount,
      snapshotRevision: order.snapshotRevision,
      createdAt: new Date(order.createdAt),
    };
    await this.prisma.orderRecord.upsert({ where: { id: order.id }, create: data, update: data });
  }

  protected async persistSnapshot(snap: SnapshotRow) {
    const data: SnapshotRecord = {
      id: snap.id,
      shopId: snap.shopId,
      orderId: snap.orderId,
      revision: snap.revision,
      sourceHash: snap.sourceHash,
      sourceUpdatedAt: new Date(snap.sourceUpdatedAt),
      encryptedPayload: snap.encryptedPayload,
    };
    await this.prisma.orderSnapshot.upsert({ where: { id: snap.id }, create: data, update: data });
  }

  protected async persistEvaluation(evaluation: EvaluationRow) {
    const data: EvaluationRecord = {
      id: evaluation.id,
      shopId: evaluation.shopId,
      snapshotId: evaluation.snapshotId,
      orderId: evaluation.orderId,
      mappingVersion: evaluation.mappingVersion,
      ruleVersion: evaluation.ruleVersion,
      promptVersion: evaluation.promptVersion,
      evaluationVersion: evaluation.evaluationVersion,
      provider: evaluation.provider,
      model: evaluation.model,
      state: evaluation.state,
      overallLabel: evaluation.overallLabel,
      uncheckedReason: evaluation.uncheckedReason,
      encryptedRequest: evaluation.encryptedRequest,
      encryptedResponse: evaluation.encryptedResponse,
      current: evaluation.current,
      createdAt: new Date(evaluation.createdAt),
    };
    await this.prisma.evaluation.upsert({ where: { id: evaluation.id }, create: data, update: data });
  }

  protected async persistFinding(finding: FindingRow) {
    const data: FindingRecord = {
      id: finding.id,
      shopId: finding.shopId,
      evaluationId: finding.evaluationId,
      orderId: finding.orderId,
      fingerprint: finding.fingerprint,
      checkId: finding.checkId,
      reasonCode: finding.reasonCode,
      itemRef: finding.itemRef,
      sourceRefsJson: JSON.stringify(finding.sourceRefs),
      evidenceJson: JSON.stringify(finding.evidence),
      method: finding.method,
      uncertain: finding.uncertain,
      templateId: finding.templateId,
      state: finding.state,
      humanReview: finding.humanReview,
      rowVersion: finding.rowVersion,
      winningProbability: finding.winningProbability ?? null,
      confidence: finding.confidence ?? null,
    };
    await this.prisma.finding.upsert({ where: { id: finding.id }, create: data, update: data });
  }

  protected async persistUsage(row: UsageLedgerRow) {
    const data: UsageRecord = {
      id: row.id,
      shopId: row.shopId,
      cycleId: row.cycleId,
      orderGid: row.orderGid,
      reservationId: row.reservationId,
      state: row.state,
      completedAt: row.completedAt ? new Date(row.completedAt) : null,
    };
    await this.prisma.usageLedger.upsert({ where: { id: row.id }, create: data, update: data });
  }

  protected async persistOutbox(row: OutboxRow) {
    const data: OutboxRecord = {
      actionKey: row.actionKey,
      shopId: row.shopId,
      orderGid: row.orderGid,
      revision: row.revision,
      actionType: row.actionType,
      tag: row.tag,
      state: row.state,
      attempts: row.attempts,
      lastError: row.lastError,
    };
    await this.prisma.actionOutbox.upsert({ where: { actionKey: row.actionKey }, create: data, update: data });
  }

  protected async persistSubscription(row: SubscriptionRow) {
    const data: SubRecord = {
      shopId: row.shopId,
      providerId: row.providerId,
      plan: row.plan,
      entitlement: row.entitlement,
      cycleId: row.cycleId,
      cycleStart: new Date(row.cycleStart),
      cycleEnd: new Date(row.cycleEnd),
      status: row.status,
      graceUntil: row.graceUntil ? new Date(row.graceUntil) : null,
      lastVerifiedAt: row.lastVerifiedAt ? new Date(row.lastVerifiedAt) : null,
    };
    await this.prisma.subscription.upsert({ where: { shopId: row.shopId }, create: data, update: data });
  }

  protected async persistJob(job: JobRecord) {
    const data: JobDbRecord = {
      id: job.id,
      type: job.type,
      shopId: job.shopId,
      installationGeneration: job.installationGeneration,
      orderGid: job.orderGid ?? null,
      payloadJson: JSON.stringify(job.payload ?? {}),
      runAfter: BigInt(job.runAfter),
      attempts: job.attempts,
      leasedUntil: job.leasedUntil === null ? null : BigInt(job.leasedUntil),
      status: job.status,
    };
    await this.prisma.job.upsert({ where: { id: job.id }, create: data, update: data });
  }

  protected async persistReceipt(row: WebhookReceiptRow) {
    const data: ReceiptRecord = {
      shopId: row.shopId,
      installationGeneration: row.installationGeneration,
      eventId: row.eventId,
      topic: row.topic,
      status: row.status,
      receivedAt: new Date(row.receivedAt),
    };
    try {
      await this.prisma.webhookReceipt.create({ data });
    } catch {
      await this.prisma.webhookReceipt.upsert({
        where: { shopId_installationGeneration_eventId: `${row.shopId}:${row.installationGeneration}:${row.eventId}` },
        create: data,
        update: data,
      });
    }
  }

  protected async persistReviewEvent(row: ReviewEventRow) {
    await this.prisma.reviewEvent.create({
      data: {
        id: row.id,
        shopId: row.shopId,
        findingId: row.findingId,
        orderId: row.orderId,
        actorStaffId: row.actorStaffId,
        action: row.action,
        note: row.note,
        timestamp: new Date(row.timestamp),
      },
    });
  }

  protected async persistAudit(row: AuditEventRow) {
    await this.prisma.auditEvent.create({
      data: {
        id: row.id,
        shopId: row.shopId,
        actorStaffId: row.actorStaffId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        revision: row.revision,
        metadataJson: JSON.stringify(row.metadata),
        timestamp: new Date(row.timestamp),
      },
    });
  }

  protected async persistInstallation(row: {
    id: string;
    shopId: string;
    generation: number;
    encryptedToken: string;
    scopes: string;
    revokedAt: string | null;
  }) {
    const data: InstallRecord = {
      id: row.id,
      shopId: row.shopId,
      generation: row.generation,
      encryptedToken: row.encryptedToken,
      scopes: row.scopes,
      installedAt: new Date(),
      revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
    };
    await this.prisma.installation.upsert({ where: { id: row.id }, create: data, update: data });
  }
}


