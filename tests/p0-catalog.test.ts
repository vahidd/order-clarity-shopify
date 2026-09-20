import { describe, expect, it } from "vitest";
import { evaluateOrder } from "../app/domain/evaluate";
import { buildSnapshot } from "../app/domain/snapshot";
import { LABEL_NO_ISSUE } from "../app/domain/constants";
import { FakeDecisionProvider, InvalidOptionsProvider } from "../app/integrations/jev/fake";
import {
  familyMapping,
  familyRules,
  oversizedOrder,
  paginationFailedOrder,
  scenarioOrders,
  shopifyOrder,
} from "../app/demo/fixtures";
import { BRACELET_PRODUCT } from "../app/demo/fixtures";
import { authHeaders, ingest, prepareShop, signedWebhook, testRuntime } from "./helpers";
import { seedDemo } from "../app/demo/seed";
import { createHttpApp } from "../app/http/createApp";
import { OrderClarityRuntime } from "../app/services/runtime";
import { DemoShopifyAdapter } from "../app/integrations/shopify/demo";
import { JevHttpProvider } from "../app/integrations/jev/http";
import { ShopifyAdminAdapter } from "../app/integrations/shopify/admin";
import { validateChoiceAnswers } from "../app/domain/providerValidate";
import { personalizationConflictQuestion } from "../app/domain/prompts";

function snapFor(order: (typeof scenarioOrders)[number], shopId = "shop") {
  return buildSnapshot({
    shopId,
    installationGeneration: 1,
    order,
    mapping: familyMapping(shopId),
    rules: familyRules(shopId),
    selectedProductGids: [BRACELET_PRODUCT, "gid://shopify/Product/necklace"],
  });
}

function orderByNumber(fragment: string) {
  const order = scenarioOrders.find((o) => o.displayNumber.includes(fragment));
  if (!order) throw new Error(`missing ${fragment}`);
  return order;
}

describe("P0 detection catalog", () => {
  it("T01 Gold purchase and explicit silver request → variant conflict", async () => {
    const result = await evaluateOrder({
      snapshot: snapFor(orderByNumber("gold+silver-note")),
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(result.findings.some((f) => f.reasonCode === "variant_conflict")).toBe(true);
    expect(result.findings[0]?.evidence.selected).toContain("gold");
    expect(snapFor(orderByNumber("gold+silver-note")).originalNote).toContain("silver");
  });

  it("T02 Sarah and later Sara correction → review finding with original text preserved", async () => {
    const order = orderByNumber("sarah-sara");
    const snapshot = snapFor(order);
    const result = await evaluateOrder({
      snapshot,
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(result.findings.some((f) => f.reasonCode === "personalization_conflict")).toBe(true);
    expect(snapshot.items[0]?.mappedAttributes[0]?.rawValue).toBe("Sarah");
    expect(snapshot.originalNote).toContain("Sara without the h");
    expect(JSON.stringify(result)).not.toContain("autocorrect");
  });

  it("T03 Gold mentioned only in unrelated gift content → no invented variant conflict", async () => {
    const result = await evaluateOrder({
      snapshot: snapFor(orderByNumber("gift-mentions-gold")),
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(result.findings.some((f) => f.reasonCode === "variant_conflict")).toBe(false);
  });

  it("T04 Mapped required engraving empty → deterministic missing finding", async () => {
    const result = await evaluateOrder({
      snapshot: snapFor(orderByNumber("missing-engraving")),
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(result.findings.some((f) => f.reasonCode === "missing_information" && f.method === "deterministic")).toBe(
      true,
    );
    expect(result.overallLabel).toBe("issues");
  });

  it("T05 Engraving source unmapped → Unchecked, not missing customer information", async () => {
    const result = await evaluateOrder({
      snapshot: snapFor(orderByNumber("unmapped-source")),
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(result.overallLabel).toBe("unchecked");
    expect(result.uncheckedReason).toBe("unchecked_unmapped");
    expect(result.findings.some((f) => f.reasonCode === "missing_information")).toBe(false);
    expect(result.providerCalled).toBe(false);
  });

  it("T06 Two items and unclear free text assignment → ambiguity or uncertain review", async () => {
    const result = await evaluateOrder({
      snapshot: snapFor(orderByNumber("two-items-three-names")),
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(
      result.findings.some((f) => f.reasonCode === "ambiguous_assignment" || f.uncertain),
    ).toBe(true);
  });

  it("T07 Two identical items with explicit same name request → no false unique name requirement", async () => {
    const result = await evaluateOrder({
      snapshot: snapFor(orderByNumber("both-emma")),
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(result.findings.some((f) => f.reasonCode === "ambiguous_assignment")).toBe(false);
  });

  it("T08 Diacritics and unusual personal name → no automatic correction", async () => {
    const snapshot = snapFor(orderByNumber("jose-diacritics"));
    const result = await evaluateOrder({
      snapshot,
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(snapshot.items[0]?.mappedAttributes[0]?.rawValue).toBe("José");
    expect(JSON.stringify(result)).not.toMatch(/"Jose"/);
  });

  it("T09 Front only policy and back engraving request → unsupported request finding", async () => {
    const result = await evaluateOrder({
      snapshot: snapFor(orderByNumber("front-only-back-request")),
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(result.findings.some((f) => f.reasonCode === "unsupported_request" && !f.uncertain)).toBe(true);
  });

  it("T10 No policy for back engraving → uncertain rather than unsupported assertion", async () => {
    const result = await evaluateOrder({
      snapshot: snapFor(orderByNumber("no-policy-back")),
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    const finding = result.findings.find((f) => f.reasonCode === "unsupported_request");
    expect(finding?.uncertain).toBe(true);
  });

  it("T11 Thank you note with otherwise complete data → No issue detected", async () => {
    const result = await evaluateOrder({
      snapshot: snapFor(orderByNumber("thank-you-complete")),
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(result.overallLabel).toBe("no_issue_detected");
    expect(result.findings.length).toBe(0);
  });

  it("T12 Unsupported operational language → Unchecked with reason", async () => {
    const result = await evaluateOrder({
      snapshot: snapFor(orderByNumber("unsupported-language")),
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(result.overallLabel).toBe("unchecked");
    expect(result.uncheckedReason).toBe("unchecked_language");
  });

  it("T13 Instruction to ignore rules inside note → no policy or action override", async () => {
    const result = await evaluateOrder({
      snapshot: snapFor(orderByNumber("ignore-rules")),
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(result.findings.some((f) => f.reasonCode === "personalization_conflict")).toBe(true);
    expect(result.overallLabel).not.toBe("no_issue_detected");
  });
});

describe("P0 intake, review, billing", () => {
  it("T14 Duplicate webhook → one effective evaluation and usage count", async () => {
    const { runtime } = testRuntime();
    const shop = await prepareShop(runtime, "shop-a.example");
    const order = orderByNumber("thank-you-complete");
    runtime.seedShopifyOrder(order);
    const signed = signedWebhook(
      { id: 1010, admin_graphql_api_id: order.orderGid, note: order.note, line_items: [{}] },
      { eventId: "dup-1", domain: shop.domain },
    );
    const a = await runtime.handleWebhook(signed.raw, signed.headers);
    const b = await runtime.handleWebhook(signed.raw, signed.headers);
    expect(a.status).toBe(200);
    expect(b.body).toMatchObject({ duplicate: true });
    await runtime.drain();
    const completed = runtime.store.usage.filter((u) => u.shopId === shop.id && u.state === "completed");
    expect(completed.length).toBe(1);
    expect(runtime.store.evaluations.size).toBe(1);
  });

  it("T15 Reversed update delivery → freshest relevant state wins", async () => {
    const { runtime, shopify } = testRuntime();
    const shop = await prepareShop(runtime, "shop-a.example");
    const stale = shopifyOrder({
      id: "gid://shopify/Order/2001",
      number: "#2001",
      note: "old note",
      updatedAt: "2026-09-01T00:00:00.000Z",
      lines: [
        {
          lineItemGid: "gid://shopify/LineItem/2001",
          productGid: BRACELET_PRODUCT,
          variantGid: "v",
          title: "Engraved bracelet",
          quantity: 1,
          selectedOptions: { finish: "gold" },
          customAttributes: [{ key: "Engraving", value: "Maya" }],
        },
      ],
    });
    const fresh = {
      ...stale,
      note: "Please make it silver instead.",
      updatedAt: "2026-09-19T00:00:00.000Z",
    };
    shopify.seed(fresh);
    const signed = signedWebhook(
      { admin_graphql_api_id: stale.orderGid, note: stale.note, updated_at: stale.updatedAt, line_items: [{}] },
      { eventId: "rev-1", domain: shop.domain, topic: "orders/updated" },
    );
    await runtime.handleWebhook(signed.raw, signed.headers);
    await runtime.drain();
    const stored = await runtime.store.getOrder(shop.id, stale.orderGid);
    const snap = runtime.store.snapshots.get(stored!.currentSnapshotId!);
    expect(snap?.payload?.originalNote).toContain("silver");
    expect(runtime.store.findings.size).toBeGreaterThan(0);
  });

  it("T16 Order changed during provider call → stale result not published as current", async () => {
    const provider = new FakeDecisionProvider();
    const shopify = new DemoShopifyAdapter();
    const { runtime } = testRuntime({ provider, shopify });
    const shop = await prepareShop(runtime, "shop-a.example");
    const order = shopifyOrder({
      id: "gid://shopify/Order/2002",
      number: "#2002",
      note: "Please make it silver instead.",
      lines: [
        {
          lineItemGid: "gid://shopify/LineItem/2002",
          productGid: BRACELET_PRODUCT,
          variantGid: "v",
          title: "Engraved bracelet",
          quantity: 1,
          selectedOptions: { finish: "gold" },
          customAttributes: [{ key: "Engraving", value: "Maya" }],
        },
      ],
    });
    shopify.seed(order);
    provider.onClassify = () => {
      shopify.updateOrder(order.orderGid, { note: "Thanks, cannot wait!", updatedAt: "2026-09-20T00:00:00.000Z" });
    };
    runtime.store.enqueueJob({
      type: "evaluate_order",
      shopId: shop.id,
      installationGeneration: 1,
      orderGid: order.orderGid,
      payload: {},
      runAfter: Date.now(),
      attempts: 0,
      leasedUntil: null,
      status: "queued",
    });
    await runtime.drain(1);
    const stored = await runtime.store.getOrder(shop.id, order.orderGid);
    expect(stored?.currentEvaluationId).toBeNull();
    await runtime.drain(5);
    const after = await runtime.store.getOrder(shop.id, order.orderGid);
    const snap = after?.currentSnapshotId ? runtime.store.snapshots.get(after.currentSnapshotId) : null;
    expect(snap?.payload?.originalNote).toContain("Thanks");
    expect(after?.overallLabel).toBe("no_issue_detected");
  });

  it("T17 Order changed while review screen open → resolution returns conflict", async () => {
    const { runtime, app } = testRuntime();
    const shop = await prepareShop(runtime, "shop-a.example");
    const stored = await ingest(runtime, shop.id, orderByNumber("gold+silver-note"));
    const finding = [...runtime.store.findings.values()].find((f) => f.orderId === stored!.id)!;
    finding.rowVersion = 1;
    const res = await app.fetch(
      new Request("http://test/api/findings/" + finding.id + "/resolve", {
        method: "POST",
        headers: authHeaders(shop.id, `${shop.domain}-owner`),
        body: JSON.stringify({
          action: "mark_reviewed",
          evaluationId: finding.evaluationId,
          rowVersion: 0,
          resolutionCategory: "confirmed_with_customer",
          note: "called customer",
        }),
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("stale_revision");
  });

  it("T18 Two simultaneous resolutions → one succeeds and other receives stale conflict", async () => {
    const { runtime, app } = testRuntime();
    const shop = await prepareShop(runtime, "shop-a.example");
    const stored = await ingest(runtime, shop.id, orderByNumber("gold+silver-note"));
    const finding = [...runtime.store.findings.values()].find((f) => f.orderId === stored!.id)!;
    const payload = {
      action: "mark_reviewed",
      evaluationId: finding.evaluationId,
      rowVersion: finding.rowVersion,
      resolutionCategory: "confirmed_with_customer",
      note: "called customer",
    };
    const req = () =>
      app.fetch(
        new Request("http://test/api/findings/" + finding.id + "/resolve", {
          method: "POST",
          headers: authHeaders(shop.id, `${shop.domain}-reviewer`),
          body: JSON.stringify(payload),
        }),
      );
    const [a, b] = await Promise.all([req(), req()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("T19 Provider timeout or overload → retry then Unchecked, never no issue", async () => {
    const provider = new FakeDecisionProvider(["timeout", "timeout", "timeout", "timeout", "timeout"]);
    const { runtime } = testRuntime({ provider });
    const shop = await prepareShop(runtime, "shop-a.example");
    await ingest(runtime, shop.id, orderByNumber("thank-you-complete"));
    const stored = await runtime.store.getOrder(shop.id, orderByNumber("thank-you-complete").orderGid);
    expect(stored?.overallLabel).toBe("unchecked");
    expect(stored?.uncheckedReason).toBe("unchecked_provider");
    expect(provider.attempts).toBeGreaterThanOrEqual(5);
    expect(stored?.overallLabel).not.toBe("no_issue_detected");
  });

  it("T20 Missing or invalid response options → provider failure, not implicit consistent result", async () => {
    const validated = validateChoiceAnswers(
      { personalizationConflict: personalizationConflictQuestion() },
      { model: "jev", answers: { personalizationConflict: { type: "choice", choice: "nope", probabilities: { nope: 1 }, confidence: 0.9 } } },
    );
    expect(validated.ok).toBe(false);
    const result = await evaluateOrder({
      snapshot: snapFor(orderByNumber("thank-you-complete")),
      rules: familyRules("shop"),
      provider: new InvalidOptionsProvider(),
    });
    expect(result.overallLabel).toBe("unchecked");
    expect(result.uncheckedReason).toBe("unchecked_provider");
    expect(result.overallLabel).not.toBe("no_issue_detected");
  });

  it("T21 Partial item pagination failure → incomplete coverage visible", async () => {
    const result = await evaluateOrder({
      snapshot: snapFor(paginationFailedOrder()),
      rules: familyRules("shop"),
      provider: new FakeDecisionProvider(),
    });
    expect(result.overallLabel).toBe("unchecked");
    expect(result.uncheckedReason).toBe("unchecked_pagination");
  });

  it("T22 App tag update emits webhook → no evaluation loop", async () => {
    const { runtime } = testRuntime();
    const shop = await prepareShop(runtime, "shop-a.example");
    await ingest(runtime, shop.id, orderByNumber("thank-you-complete"));
    const calls = runtime.providerCalls;
    const signed = signedWebhook(
      { admin_graphql_api_id: orderByNumber("thank-you-complete").orderGid, tags: "orderclarity:reviewed" },
      { eventId: "tag-loop", domain: shop.domain, topic: "orders/updated" },
    );
    await runtime.handleWebhook(signed.raw, signed.headers);
    await runtime.drain();
    expect(runtime.providerCalls).toBe(calls);
  });

  it("T23 Shopify tag write times out after success → reconciliation without duplicate side effect", async () => {
    const shopify = new DemoShopifyAdapter();
    shopify.mutationBlocked = false;
    shopify.tagWriteTimeoutAfterSuccess = true;
    const { runtime } = testRuntime({ shopify });
    const shop = await prepareShop(runtime, "shop-a.example");
    shop.mode = "assisted_review";
    await ingest(runtime, shop.id, orderByNumber("gold+silver-note"));
    await runtime.flushOutbox(shop);
    const keys = [...runtime.store.outbox.values()].map((o) => o.actionKey);
    expect(new Set(keys).size).toBe(keys.length);
    const adds = shopify.tagWrites.filter((w) => w.add?.includes("orderclarity:needs-review"));
    expect(adds.length).toBeGreaterThanOrEqual(1);
  });

  it("T24 Shop A requests Shop B order → no data disclosure or mutation", async () => {
    const { runtime, app } = testRuntime();
    const a = await prepareShop(runtime, "shop-a.example");
    const b = await prepareShop(runtime, "shop-b.example");
    const secret = await ingest(runtime, b.id, {
      ...orderByNumber("sarah-sara"),
      orderGid: "gid://shopify/Order/shop-b-secret",
      displayNumber: "#B-SECRET",
      note: "secret-from-shop-b",
    });
    const res = await app.fetch(
      new Request(`http://test/api/orders/${secret!.id}`, { headers: authHeaders(a.id, `${a.domain}-owner`) }),
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("secret-from-shop-b");
    expect(text).not.toContain("Sarah");
  });

  it("T25 Forged webhook signature → rejected before enqueue", async () => {
    const { runtime } = testRuntime();
    await prepareShop(runtime, "shop-a.example");
    const raw = Buffer.from(JSON.stringify({ admin_graphql_api_id: "gid://shopify/Order/1", line_items: [{}] }));
    const headers = new Headers({
      "x-shopify-hmac-sha256": "forged",
      "x-shopify-shop-domain": "shop-a.example",
      "x-shopify-topic": "orders/create",
      "x-shopify-event-id": "forged-1",
    });
    const before = runtime.webhookEnqueues;
    const result = await runtime.handleWebhook(raw, headers);
    expect(result.status).toBe(401);
    expect(runtime.webhookEnqueues).toBe(before);
  });

  it("T26 Viewer sends resolution request → forbidden", async () => {
    const { runtime, app } = testRuntime();
    const shop = await prepareShop(runtime, "shop-a.example");
    const stored = await ingest(runtime, shop.id, orderByNumber("gold+silver-note"));
    const finding = [...runtime.store.findings.values()].find((f) => f.orderId === stored!.id)!;
    const res = await app.fetch(
      new Request("http://test/api/findings/" + finding.id + "/resolve", {
        method: "POST",
        headers: authHeaders(shop.id, `${shop.domain}-viewer`),
        body: JSON.stringify({
          action: "mark_reviewed",
          evaluationId: finding.evaluationId,
          rowVersion: finding.rowVersion,
          resolutionCategory: "confirmed_with_customer",
          note: "nope",
        }),
      }),
    );
    expect(res.status).toBe(403);
    expect(finding.state).toBe("open");
  });

  it("T27 Last remaining quota and concurrent orders → no over counting or hidden overage", async () => {
    const { runtime } = testRuntime();
    const shop = await prepareShop(runtime, "shop-a.example", { entitlement: 1 });
    const o1 = orderByNumber("thank-you-complete");
    const o2 = {
      ...orderByNumber("jose-diacritics"),
      orderGid: "gid://shopify/Order/3002",
    };
    runtime.seedShopifyOrder(o1);
    runtime.seedShopifyOrder(o2);
    const shopRow = await runtime.store.getShop(shop.id)!;
    runtime.store.enqueueJob({
      type: "evaluate_order",
      shopId: shop.id,
      installationGeneration: shopRow.installationGeneration,
      orderGid: o1.orderGid,
      payload: {},
      runAfter: Date.now(),
      attempts: 0,
      leasedUntil: null,
      status: "queued",
    });
    runtime.store.enqueueJob({
      type: "evaluate_order",
      shopId: shop.id,
      installationGeneration: shopRow.installationGeneration,
      orderGid: o2.orderGid,
      payload: {},
      runAfter: Date.now(),
      attempts: 0,
      leasedUntil: null,
      status: "queued",
    });
    await Promise.all([runtime.evaluateFresh(shopRow, o1.orderGid), runtime.evaluateFresh(shopRow, o2.orderGid)]);
    const completed = runtime.store.usage.filter((u) => u.shopId === shop.id && u.state === "completed");
    expect(completed.length).toBe(1);
    const labels = [...runtime.store.orders.values()].filter((o) => o.shopId === shop.id).map((o) => o.overallLabel);
    expect(labels).toContain("unchecked");
  });

  it("T28 Same order rescanned in cycle → one completed usage charge", async () => {
    const { runtime } = testRuntime();
    const shop = await prepareShop(runtime, "shop-a.example");
    await ingest(runtime, shop.id, orderByNumber("thank-you-complete"));
    await ingest(runtime, shop.id, orderByNumber("thank-you-complete"));
    const completed = runtime.store.usage.filter((u) => u.shopId === shop.id && u.state === "completed");
    expect(completed.length).toBe(1);
  });

  it("T29 Failed scan then retry succeeds → count once after completion", async () => {
    const provider = new FakeDecisionProvider(["timeout", "timeout", "timeout", "timeout", "timeout"]);
    const { runtime } = testRuntime({ provider });
    const shop = await prepareShop(runtime, "shop-a.example");
    await ingest(runtime, shop.id, orderByNumber("thank-you-complete"));
    expect(runtime.store.usage.filter((u) => u.state === "completed").length).toBe(0);
    provider.behaviors = ["ok"];
    const row = await runtime.store.getOrder(shop.id, orderByNumber("thank-you-complete").orderGid)!;
    row.contentHash = "stale";
    await ingest(runtime, shop.id, orderByNumber("thank-you-complete"));
    expect(runtime.store.usage.filter((u) => u.shopId === shop.id && u.state === "completed").length).toBe(1);
  });

  it("T30 Billing outage passes grace period → new scans pause and reviews remain usable", async () => {
    const { runtime, app } = testRuntime();
    const shop = await prepareShop(runtime, "shop-a.example");
    const stored = await ingest(runtime, shop.id, orderByNumber("gold+silver-note"));
    await runtime.startGrace(shop.id, new Date("2026-01-01"));
    await runtime.expireGrace(shop.id);
    const finding = [...runtime.store.findings.values()].find((f) => f.orderId === stored!.id)!;
    const resolve = await app.fetch(
      new Request("http://test/api/findings/" + finding.id + "/resolve", {
        method: "POST",
        headers: authHeaders(shop.id, `${shop.domain}-reviewer`),
        body: JSON.stringify({
          action: "mark_reviewed",
          evaluationId: finding.evaluationId,
          rowVersion: finding.rowVersion,
          resolutionCategory: "confirmed_with_customer",
          note: "still usable",
        }),
      }),
    );
    expect(resolve.status).toBe(200);
    await ingest(runtime, shop.id, orderByNumber("thank-you-complete"));
    const paused = await runtime.store.getOrder(shop.id, orderByNumber("thank-you-complete").orderGid);
    expect(paused?.uncheckedReason).toBe("unchecked_plan_limit");
  });

  it("T31 Uninstall while work queued → no subsequent provider or Shopify processing", async () => {
    const provider = new FakeDecisionProvider();
    const shopify = new DemoShopifyAdapter();
    const { runtime } = testRuntime({ provider, shopify });
    const shop = await prepareShop(runtime, "shop-a.example");
    runtime.seedShopifyOrder(orderByNumber("thank-you-complete"));
    runtime.store.enqueueJob({
      type: "evaluate_order",
      shopId: shop.id,
      installationGeneration: shop.installationGeneration,
      orderGid: orderByNumber("thank-you-complete").orderGid,
      payload: {},
      runAfter: Date.now(),
      attempts: 0,
      leasedUntil: null,
      status: "queued",
    });
    const calls = provider.classifyCalls;
    await runtime.uninstall(shop.id);
    await runtime.drain();
    expect(provider.classifyCalls).toBe(calls);
    expect(shopify.fetchCalls).toBe(0);
  });

  it("T32 Customer redaction → required content deleted including evaluation copies", async () => {
    const { runtime } = testRuntime();
    const shop = await prepareShop(runtime, "shop-a.example");
    const stored = await ingest(runtime, shop.id, orderByNumber("sarah-sara"));
    await runtime.redactCustomer(shop.id, [orderByNumber("sarah-sara").orderGid]);
    const snap = runtime.store.snapshots.get(stored!.currentSnapshotId!);
    const ev = runtime.store.evaluations.get(stored!.currentEvaluationId!);
    expect(snap?.payload).toBeNull();
    expect(snap?.encryptedPayload).toBeNull();
    expect(ev?.encryptedRequest).toBeNull();
    expect(ev?.encryptedResponse).toBeNull();
    const blob = JSON.stringify([...runtime.store.snapshots.values()]) + JSON.stringify([...runtime.store.evaluations.values()]);
    expect(blob).not.toContain("Sarah");
  });

  it("T33 New rule version activated → current relevant orders become pending reassessment", async () => {
    const { runtime, app } = testRuntime();
    const shop = await prepareShop(runtime, "shop-a.example");
    await ingest(runtime, shop.id, orderByNumber("thank-you-complete"));
    const next = { ...familyRules(shop.id), id: "rules-v2", version: "2", status: "draft" as const };
    runtime.store.upsertRules(next);
    const res = await app.fetch(
      new Request(`http://test/api/rules/${next.id}/activate`, {
        method: "POST",
        headers: authHeaders(shop.id, `${shop.domain}-owner`),
      }),
    );
    expect(res.status).toBe(200);
    expect(runtime.store.jobs.some((j) => j.status === "queued" && j.payload.reason === "rule_activation")).toBe(true);
  });

  it("T34 Oversized payload or too many items → Unchecked, no silent truncation", async () => {
    const provider = new FakeDecisionProvider();
    const result = await evaluateOrder({
      snapshot: snapFor(oversizedOrder()),
      rules: familyRules("shop"),
      provider,
    });
    expect(result.overallLabel).toBe("unchecked");
    expect(result.uncheckedReason).toBe("unchecked_limit");
    expect(result.providerCalled).toBe(false);
    expect(result.relevantItemCount).toBeGreaterThan(20);
    expect(provider.classifyCalls).toBe(0);
  });
});

describe("Demo seed and adapters", () => {
  it("seeded demo queue preserves original text and reason labels", async () => {
    const runtime = new OrderClarityRuntime({
      shopify: new DemoShopifyAdapter(),
      provider: new FakeDecisionProvider(),
      config: { mode: "demo", shopifySecret: "demo-webhook-secret", encryptionKey: "k", allowTestAuth: true, demoLabel: true },
    });
    await seedDemo(runtime);
    const app = createHttpApp(runtime);
    const overview = await app.fetch(new Request("http://demo/api/overview"));
    const overviewBody = await overview.json();
    expect(overviewBody.demo).toBe(true);
    expect(overviewBody.label).toBe("Demo");
    expect(overviewBody.operatingMode).toBe("observation");
    expect(overviewBody.unresolvedIssues).toBeGreaterThan(0);
    expect(overviewBody.uncheckedOrders).toBeGreaterThan(0);
    const queue = await app.fetch(new Request("http://demo/api/orders?tab=all"));
    const q = await queue.json();
    const numbers = q.rows.map((r: { displayNumber: string }) => r.displayNumber).join(" ");
    expect(numbers).toContain("gold+silver-note");
    const gold = q.rows.find((r: { displayNumber: string }) => r.displayNumber.includes("gold+silver-note"));
    expect(String(gold.primaryReasonLabel).toLowerCase()).toContain("variant conflict");
    expect(gold.originalNote).toContain("silver");
    const missing = q.rows.find((r: { displayNumber: string }) => r.displayNumber.includes("missing-engraving"));
    expect(String(missing.primaryReasonLabel).toLowerCase()).toContain("missing");
    const unmapped = q.rows.find((r: { displayNumber: string }) => r.displayNumber.includes("unmapped-source"));
    expect(unmapped.overallLabel).toBe("unchecked");
    expect(String(unmapped.primaryReasonLabel).toLowerCase()).not.toContain(LABEL_NO_ISSUE.toLowerCase());
  });

  it("live adapters exist and are distinct from demo", () => {
    expect(typeof JevHttpProvider).toBe("function");
    expect(typeof ShopifyAdminAdapter).toBe("function");
    const live = new ShopifyAdminAdapter(async () => ({ json: async () => ({}) }));
    expect(live.kind).toBe("live");
    expect(live.apiVersion).toBe("2026-07");
    const demo = new DemoShopifyAdapter();
    expect(demo.kind).toBe("demo");
  });
});
