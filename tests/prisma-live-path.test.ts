import { describe, expect, it } from "vitest";
import { FakeDecisionProvider } from "../app/integrations/jev/fake";
import { DemoShopifyAdapter } from "../app/integrations/shopify/demo";
import { createMemoryPrisma, PrismaStore } from "../app/repositories/prisma";
import { OrderClarityRuntime } from "../app/services/runtime";
import { ingest, prepareShop, signedWebhook } from "./helpers";
import { scenarioOrders } from "../app/demo/fixtures";
import type { AuthContext } from "../app/domain/types";

const KEY = "test-encryption-key-not-for-production";

function orderByNumber(fragment: string) {
  const order = scenarioOrders.find((o) => o.displayNumber.includes(fragment));
  if (!order) throw new Error(`missing ${fragment}`);
  return order;
}

function prismaRuntime(store: PrismaStore, shopify?: DemoShopifyAdapter, provider?: FakeDecisionProvider) {
  return new OrderClarityRuntime({
    store,
    shopify: shopify ?? new DemoShopifyAdapter(),
    provider: provider ?? new FakeDecisionProvider(),
    config: {
      mode: "demo",
      shopifySecret: "test-secret",
      encryptionKey: KEY,
      allowTestAuth: true,
      demoLabel: true,
    },
  });
}

function ownerAuth(shop: { id: string; domain: string; installationGeneration: number }): AuthContext {
  return {
    shopId: shop.id,
    shopDomain: shop.domain,
    installationGeneration: shop.installationGeneration,
    staffId: `${shop.domain}-owner`,
    role: "owner",
    requestId: "two-instance",
  };
}

describe("PrismaStore live path", () => {
  it("duplicate webhook does not re-enqueue across a new PrismaStore (T14, no hydrate)", async () => {
    const db = createMemoryPrisma();
    const store1 = new PrismaStore(db, KEY);
    const shopify = new DemoShopifyAdapter();
    const rt1 = prismaRuntime(store1, shopify);
    const shop = await prepareShop(rt1, "shop-a.example");
    const order = orderByNumber("thank-you-complete");
    shopify.seed(order);
    const signed = signedWebhook(
      { id: 1010, admin_graphql_api_id: order.orderGid, note: order.note, line_items: [{}] },
      { eventId: "dup-restart-1", domain: shop.domain },
    );
    const first = await rt1.handleWebhook(signed.raw, signed.headers);
    expect(first.body).toMatchObject({ enqueued: true });
    await rt1.drain();
    await store1.flush();
    expect((await rt1.store.listUsage(shop.id)).filter((u) => u.state === "completed")).toHaveLength(1);

    const store2 = new PrismaStore(db, KEY);
    expect(store2.receipts.size).toBe(0);
    expect(store2.orders.size).toBe(0);
    const rt2 = prismaRuntime(store2, shopify);
    const beforeJobs = (await db.job.findMany()).filter((j) => j.status === "queued").length;
    const beforeEnqueues = rt2.webhookEnqueues;
    const second = await rt2.handleWebhook(signed.raw, signed.headers);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true });
    expect(rt2.webhookEnqueues).toBe(beforeEnqueues);
    expect(store2.jobs).toHaveLength(0);
    await rt2.drain();
    const queuedAfter = (await db.job.findMany()).filter((j) => j.status === "queued").length;
    expect(queuedAfter).toBe(beforeJobs);
    expect((await store2.listUsage(shop.id)).filter((u) => u.state === "completed")).toHaveLength(1);
  });

  it("UsageLedger allows a released row and a new reservation for the same order (T29)", async () => {
    const db = createMemoryPrisma();
    const store = new PrismaStore(db, KEY);
    const shopify = new DemoShopifyAdapter();
    const provider = new FakeDecisionProvider(["timeout", "timeout", "timeout", "timeout", "timeout"]);
    const runtime = prismaRuntime(store, shopify, provider);
    const shop = await prepareShop(runtime, "shop-a.example");
    await ingest(runtime, shop.id, orderByNumber("thank-you-complete"));
    await store.flush();
    const firstCycle = await store.listUsage(shop.id);
    expect(firstCycle.filter((u) => u.state === "completed")).toHaveLength(0);
    expect(firstCycle.some((u) => u.state === "released")).toBe(true);

    provider.behaviors = ["ok"];
    const row = await runtime.store.getOrder(shop.id, orderByNumber("thank-you-complete").orderGid);
    expect(row).not.toBeNull();
    row!.contentHash = "stale";
    runtime.store.saveOrder(row!);
    await ingest(runtime, shop.id, orderByNumber("thank-you-complete"));
    await store.flush();

    const ledger = await db.usageLedger.findMany();
    const forOrder = ledger.filter((u) => u.orderGid === orderByNumber("thank-you-complete").orderGid);
    expect(forOrder.length).toBeGreaterThanOrEqual(2);
    expect(forOrder.some((u) => u.state === "released")).toBe(true);
    expect(forOrder.some((u) => u.state === "completed")).toBe(true);
    expect(new Set(forOrder.map((u) => u.reservationId)).size).toBe(forOrder.length);
    expect((await store.listUsage(shop.id)).filter((u) => u.state === "completed")).toHaveLength(1);
  });

  it("web queue/detail/resolve read worker-written Prisma rows without hydrate", async () => {
    const db = createMemoryPrisma();
    const webStore = new PrismaStore(db, KEY);
    const workerStore = new PrismaStore(db, KEY);
    const shopify = new DemoShopifyAdapter();
    const provider = new FakeDecisionProvider();
    const web = prismaRuntime(webStore, shopify, provider);
    const worker = prismaRuntime(workerStore, shopify, provider);
    const shop = await prepareShop(web, "shop-a.example");
    await webStore.flush();

    const order = orderByNumber("gold+silver-note");
    shopify.seed(order);
    const signed = signedWebhook(
      { id: 1011, admin_graphql_api_id: order.orderGid, note: order.note, line_items: [{}] },
      { eventId: "two-instance-1", domain: shop.domain },
    );
    const enqueued = await web.handleWebhook(signed.raw, signed.headers);
    expect(enqueued.body).toMatchObject({ enqueued: true });
    await web.flush();

    expect(workerStore.jobs).toHaveLength(0);
    expect(workerStore.orders.size).toBe(0);
    expect(workerStore.findings.size).toBe(0);
    expect(webStore.orders.size).toBe(0);
    expect((await db.job.findMany({ where: { status: "queued" } })).length).toBeGreaterThan(0);

    const n = await worker.drain(5);
    expect(n).toBeGreaterThan(0);

    expect(webStore.orders.size).toBe(0);
    expect(webStore.findings.size).toBe(0);
    expect(webStore.evaluations.size).toBe(0);

    const auth = ownerAuth(shop);
    const queue = await web.queue(auth, new URLSearchParams({ tab: "all" }));
    const queued = queue.rows.find((r) => r.orderGid === order.orderGid);
    expect(queued?.processingState).toBe("complete");
    expect(queued?.overallLabel).toBe("issues");
    expect(webStore.orders.size).toBe(0);

    const stored = await web.store.getOrder(shop.id, order.orderGid);
    expect(stored?.processingState).toBe("complete");
    expect(webStore.orders.size).toBe(0);

    const detail = await web.orderDetail(auth, stored!.id);
    expect(detail?.order.processingState).toBe("complete");
    expect(detail?.findings.length).toBeGreaterThan(0);
    expect(webStore.orders.size).toBe(0);
    expect(webStore.findings.size).toBe(0);

    const finding = detail!.findings[0];
    const resolved = await web.resolveFinding(auth, finding.id, {
      action: "awaiting_customer",
      evaluationId: finding.evaluationId,
      rowVersion: finding.rowVersion,
    });
    expect(resolved.status).toBe(200);
    const after = await web.store.getFinding(shop.id, finding.id);
    expect(after?.state).toBe("awaiting_customer");
  });
});
