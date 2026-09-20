import { describe, expect, it } from "vitest";
import { createHttpApp } from "../app/http/createApp";
import { FakeDecisionProvider } from "../app/integrations/jev/fake";
import { DemoShopifyAdapter } from "../app/integrations/shopify/demo";
import { ShopifyAdminAdapter } from "../app/integrations/shopify/admin";
import { createMemoryPrisma, PrismaStore } from "../app/repositories/prisma";
import { createLiveRuntime } from "../app/server/create-live-runtime";
import { OrderClarityRuntime } from "../app/services/runtime";
import { authHeaders, prepareShop, testRuntime } from "./helpers";
import { BRACELET_PRODUCT } from "../app/demo/fixtures";
import { evaluateOrder } from "../app/domain/evaluate";

describe("onboarding HTTP flow", () => {
  it("walks Install → Choose products → Map → Define rules → Review sample → Activate", async () => {
    const provider = new FakeDecisionProvider();
    const { runtime, app } = testRuntime({ provider });
    const shop = runtime.store.createShop({
      domain: "onboard.example",
      onboardingStep: "install",
    });
    runtime.store.createUser({
      shopId: shop.id,
      verifiedStaffId: "owner-1",
      role: "owner",
      active: true,
      displayName: "Owner",
    });
    const headers = authHeaders(shop.id, "owner-1");

    const start = await app.fetch(new Request("http://test/api/onboarding", { headers }));
    const startBody = await start.json();
    expect(startBody.step).toBe("install");
    expect(startBody.steps).toEqual([
      "install",
      "choose_products",
      "map_fields",
      "define_rules",
      "review_sample",
      "activate",
    ]);

    const products = await app.fetch(
      new Request("http://test/api/onboarding/products", {
        method: "POST",
        headers,
        body: JSON.stringify({ productGids: [BRACELET_PRODUCT] }),
      }),
    );
    expect(products.status).toBe(200);
    expect((await products.json()).step).toBe("map_fields");

    const mapping = await app.fetch(
      new Request("http://test/api/mappings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          scope: "engraved-gifts",
          productGids: [BRACELET_PRODUCT],
          entries: [
            { sourceKey: "Engraving", fieldRole: "personalization_content", roleName: "engraving" },
          ],
        }),
      }),
    );
    expect(mapping.status).toBe(200);

    const draft = await app.fetch(
      new Request("http://test/api/rules", {
        method: "POST",
        headers,
        body: JSON.stringify({
          requiredRoles: ["engraving"],
          maxGraphemes: 20,
          surfaces: ["front"],
          allowedOptions: { finish: ["gold", "silver"] },
        }),
      }),
    );
    expect(draft.status).toBe(200);
    const draftBody = await draft.json();
    const ruleId = draftBody.rules.id;
    expect(draftBody.rules.status).toBe("draft");

    const callsBefore = provider.classifyCalls;
    const preview = await app.fetch(
      new Request(`http://test/api/rules/${ruleId}/preview`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      }),
    );
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.preview).toBe(true);
    expect(previewBody.activated).toBe(false);
    expect(previewBody.tagsWritten).toBe(false);
    expect(previewBody.rulesStatus).toBe("draft");
    expect(previewBody.outboxUnchanged).toBe(true);
    expect(previewBody.providerCalled).toBe(true);
    expect(provider.classifyCalls).toBeGreaterThan(callsBefore);
    expect(previewBody.originalNote).toContain("silver");
    expect(previewBody.findings.some((f: { reasonCode: string }) => f.reasonCode === "variant_conflict")).toBe(true);
    expect((await runtime.store.getRule(shop.id, ruleId))?.status).toBe("draft");
    expect(runtime.store.outbox.size).toBe(0);
    expect(await runtime.store.activeRules(shop.id)).toBeNull();

    const activate = await app.fetch(
      new Request(`http://test/api/rules/${ruleId}/activate`, { method: "POST", headers }),
    );
    expect(activate.status).toBe(200);
    expect((await runtime.store.activeRules(shop.id))?.id).toBe(ruleId);

    const done = await app.fetch(
      new Request("http://test/api/onboarding/activate", { method: "POST", headers }),
    );
    expect(done.status).toBe(200);
    expect((await done.json()).step).toBe("activate");
    expect((await runtime.getOnboarding({
      shopId: shop.id,
      shopDomain: shop.domain,
      installationGeneration: 1,
      staffId: "owner-1",
      role: "owner",
      requestId: "t",
    })).step).toBe("activate");
  });

  it("preview uses evaluateOrder and never writes tags even in assisted review", async () => {
    const shopify = new DemoShopifyAdapter();
    shopify.mutationBlocked = false;
    const provider = new FakeDecisionProvider();
    const runtime = new OrderClarityRuntime({
      shopify,
      provider,
      config: { mode: "demo", shopifySecret: "test-secret", encryptionKey: "k", allowTestAuth: true, demoLabel: true },
    });
    const shop = await prepareShop(runtime, "preview.example");
    shop.mode = "assisted_review";
    const app = createHttpApp(runtime);
    const headers = authHeaders(shop.id, `${shop.domain}-owner`);
    const draft = await runtime.saveRuleDraft(
      {
        shopId: shop.id,
        shopDomain: shop.domain,
        installationGeneration: 1,
        staffId: `${shop.domain}-owner`,
        role: "owner",
        requestId: "t",
      },
      { requiredRoles: ["engraving"], surfaces: ["front"], allowedOptions: { finish: ["gold", "silver"] } },
    );
    const ruleId = (draft.body as { rules: { id: string } }).rules.id;
    const res = await app.fetch(
      new Request(`http://test/api/rules/${ruleId}/preview`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();
    expect(body.preview).toBe(true);
    expect(body.tagsWritten).toBe(false);
    expect(shopify.tagWrites.length).toBe(0);
    expect((await runtime.store.activeRules(shop.id))?.id).not.toBe(ruleId);
  });

  it("unidentified staff cannot mutate onboarding", async () => {
    const { runtime, app } = testRuntime();
    const shop = runtime.store.createShop({ domain: "noid.example" });
    const headers = {
      "x-orderclarity-test-session": JSON.stringify({ shopId: shop.id, staffId: null }),
      "content-type": "application/json",
    };
    const auth = await runtime.authenticate(new Headers(headers), new URL("http://test/api/onboarding"));
    expect("role" in auth && auth.role).toBe("unidentified");
    const res = await app.fetch(
      new Request("http://test/api/onboarding/products", {
        method: "POST",
        headers,
        body: JSON.stringify({ productGids: [BRACELET_PRODUCT] }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("live session tenant and Prisma persistence", () => {
  it("createLiveRuntime uses ShopifyAdminAdapter scoped to the session shop", async () => {
    const shopsCalled: string[] = [];
    const store = new (await import("../app/store/memory")).MemoryStore();
    const shop = store.createShop({ domain: "a.myshopify.com" });
    const runtime = createLiveRuntime({
      config: {
        mode: "live",
        port: 3000,
        shopifyApiSecret: "secret",
        encryptionKey: "key",
        jevModel: "jev-latest",
        adminApiVersion: "2026-07",
        typesafeApiKey: "ts",
      },
      store,
      provider: new FakeDecisionProvider(),
      graphqlForShop: async (shopId) => {
        shopsCalled.push(shopId);
        return async () => ({ json: async () => ({ data: { order: null } }) });
      },
    });
    expect(runtime.shopify.kind).toBe("live");
    expect(runtime.shopify).toBeInstanceOf(ShopifyAdminAdapter);
    await runtime.shopify.fetchOrder(shop.id, "gid://shopify/Order/1");
    expect(shopsCalled).toEqual([shop.id]);
  });

  it("ensureTenantFromSession does not default unidentified staff to owner", async () => {
    const runtime = new OrderClarityRuntime();
    const owner = await runtime.ensureTenantFromSession({
      shop: "owner-shop.myshopify.com",
      userId: "99",
      accountOwner: true,
    });
    expect(owner.role).toBe("owner");
    const other = await runtime.ensureTenantFromSession({
      shop: "owner-shop.myshopify.com",
      userId: "100",
      accountOwner: false,
    });
    expect(other.role).toBe("unidentified");
    expect(other.shopId).toBe(owner.shopId);
    const noId = await runtime.ensureTenantFromSession({ shop: "owner-shop.myshopify.com" });
    expect(noId.role).toBe("unidentified");
    expect(noId.staffId).toBeNull();
  });

  it("Shop A session cannot load Shop B via ensureTenantFromSession", async () => {
    const runtime = new OrderClarityRuntime();
    const a = await runtime.ensureTenantFromSession({ shop: "a.myshopify.com", userId: "1", accountOwner: true });
    const b = await runtime.ensureTenantFromSession({ shop: "b.myshopify.com", userId: "2", accountOwner: true });
    runtime.store.saveOrder({
      id: "order-b",
      shopId: b.shopId,
      orderGid: "gid://shopify/Order/secret",
      displayNumber: "#B",
      currentSnapshotId: null,
      currentEvaluationId: null,
      rowVersion: 1,
      processingState: "complete",
      overallLabel: "issues",
      uncheckedReason: null,
      humanReview: "not_reviewed",
      assignee: null,
      lastEvaluatedAt: null,
      contentHash: null,
      customerId: null,
      lifecycle: "active",
      productSummary: "secret",
      primaryReason: "variant_conflict",
      issueCount: 1,
      createdAt: new Date().toISOString(),
      snapshotRevision: 1,
    });
    const app = createHttpApp(runtime);
    const res = await app.fetch(
      new Request("http://test/api/orders/order-b", {
        headers: authHeaders(a.shopId, "1"),
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("secret");
  });

  it("PrismaStore writes tenant-scoped Shop/Order/Snapshot/Evaluation/Finding/Outbox/Usage rows", async () => {
    const db = createMemoryPrisma();
    const store = new PrismaStore(db, "test-encryption-key-not-for-production");
    const shopA = store.createShop({ domain: "a.myshopify.com" });
    const shopB = store.createShop({ domain: "b.myshopify.com" });
    store.saveOrder({
      id: "ord-1",
      shopId: shopA.id,
      orderGid: "gid://shopify/Order/1",
      displayNumber: "#1",
      currentSnapshotId: null,
      currentEvaluationId: null,
      rowVersion: 1,
      processingState: "complete",
      overallLabel: "issues",
      uncheckedReason: null,
      humanReview: "not_reviewed",
      assignee: null,
      lastEvaluatedAt: null,
      contentHash: "abc",
      customerId: null,
      lifecycle: "active",
      productSummary: "bracelet",
      primaryReason: "variant_conflict",
      issueCount: 1,
      createdAt: new Date().toISOString(),
      snapshotRevision: 1,
    });
    store.putSnapshot({
      id: "snap-1",
      shopId: shopA.id,
      orderId: "ord-1",
      revision: 1,
      sourceHash: "abc",
      sourceUpdatedAt: new Date().toISOString(),
      payload: {
        schemaVersion: 1,
        shopId: shopA.id,
        installationGeneration: 1,
        orderGid: "gid://shopify/Order/1",
        displayNumber: "#1",
        shopifyUpdatedAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
        cancelled: false,
        fulfillmentSummary: "",
        originalNote: "Please make it silver",
        shopifyTags: [],
        items: [],
        mappingVersion: "1",
        ruleVersion: "1",
        mappingComplete: true,
        paginationComplete: true,
        customerId: null,
      },
    });
    store.saveEvaluation({
      id: "ev-1",
      shopId: shopA.id,
      snapshotId: "snap-1",
      orderId: "ord-1",
      mappingVersion: "1",
      ruleVersion: "1",
      promptVersion: "p",
      evaluationVersion: "e",
      provider: "fake",
      model: "fake",
      state: "complete",
      overallLabel: "issues",
      uncheckedReason: null,
      encryptedRequest: null,
      encryptedResponse: null,
      current: true,
      createdAt: new Date().toISOString(),
    });
    store.saveFinding({
      id: "f-1",
      shopId: shopA.id,
      evaluationId: "ev-1",
      orderId: "ord-1",
      fingerprint: "x",
      checkId: "SEM02",
      reasonCode: "variant_conflict",
      itemRef: null,
      sourceRefs: [],
      evidence: {},
      method: "semantic",
      uncertain: false,
      templateId: "sem02_conflict",
      state: "open",
      humanReview: "not_reviewed",
      rowVersion: 1,
    });
    store.saveOutbox({
      actionKey: "k1",
      shopId: shopA.id,
      orderGid: "gid://shopify/Order/1",
      revision: 1,
      actionType: "add",
      tag: "orderclarity:needs-review",
      state: "pending",
      attempts: 0,
      lastError: null,
    });
    store.saveUsage({
      id: "u1",
      shopId: shopA.id,
      cycleId: "c1",
      orderGid: "gid://shopify/Order/1",
      reservationId: "r1",
      state: "completed",
      completedAt: new Date().toISOString(),
    });
    await store.flush();

    const orders = await db.orderRecord.findMany();
    expect(orders).toHaveLength(1);
    expect(orders[0]?.shopId).toBe(shopA.id);
    expect(await store.getOrder(shopB.id, "gid://shopify/Order/1")).toBeNull();
    expect((await db.orderSnapshot.findMany())[0]?.shopId).toBe(shopA.id);
    expect((await db.evaluation.findMany())[0]?.shopId).toBe(shopA.id);
    expect((await db.finding.findMany())[0]?.shopId).toBe(shopA.id);
    expect((await db.actionOutbox.findMany())[0]?.shopId).toBe(shopA.id);
    expect((await db.usageLedger.findMany())[0]?.shopId).toBe(shopA.id);

    const store2 = new PrismaStore(db, "test-encryption-key-not-for-production");
    expect(store2.orders.size).toBe(0);
    expect((await store2.getOrder(shopA.id, "gid://shopify/Order/1"))?.displayNumber).toBe("#1");
    expect((await store2.getSnapshot("snap-1"))?.payload?.originalNote).toContain("silver");
    expect(await store2.getOrder(shopB.id, "gid://shopify/Order/1")).toBeNull();
    expect(store2.orders.size).toBe(0);
  });
});

describe("live constructor guard", () => {
  it("refuses to boot live mode with the demo Shopify adapter", () => {
    expect(
      () =>
        new OrderClarityRuntime({
          shopify: new DemoShopifyAdapter(),
          config: { mode: "live", shopifySecret: "s", encryptionKey: "k", allowTestAuth: false, demoLabel: false },
        }),
    ).toThrow(/ShopifyAdminAdapter/);
  });
});

describe("preview drives evaluateOrder", () => {
  it("does not skip the shipped evaluator", async () => {
    const runtime = new OrderClarityRuntime();
    const shop = await prepareShop(runtime, "eval.example");
    const auth = {
      shopId: shop.id,
      shopDomain: shop.domain,
      installationGeneration: 1,
      staffId: `${shop.domain}-owner`,
      role: "owner" as const,
      requestId: "t",
    };
    const saved = await runtime.saveRuleDraft(auth, {
      requiredRoles: ["engraving"],
      surfaces: ["front"],
      allowedOptions: { finish: ["gold", "silver"] },
    });
    const id = (saved.body as { rules: { id: string } }).rules.id;
    const preview = await runtime.previewRules(auth, id);
    expect(preview.status).toBe(200);
    const body = preview.body as { findings: Array<{ reasonCode: string }>; originalNote: string; providerCalled: boolean };
    const direct = await evaluateOrder({
      snapshot: {
        schemaVersion: 1,
        shopId: shop.id,
        installationGeneration: 1,
        orderGid: "gid://shopify/Order/preview-synthetic",
        displayNumber: "#preview-synthetic",
        shopifyUpdatedAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
        cancelled: false,
        fulfillmentSummary: "UNFULFILLED",
        originalNote: body.originalNote,
        shopifyTags: [],
        items: [],
        mappingVersion: "1",
        ruleVersion: "1",
        mappingComplete: true,
        paginationComplete: true,
        customerId: null,
      },
      rules: (await runtime.store.getRule(shop.id, id))!,
      provider: new FakeDecisionProvider(),
    });
    expect(body.providerCalled).toBe(true);
    expect(body.findings.length).toBeGreaterThan(0);
    expect(direct.providerCalled).toBe(true);
  });
});
