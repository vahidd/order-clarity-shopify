import { familyMapping, familyRules, shopifyOrder } from "../app/demo/fixtures";
import { createHttpApp } from "../app/http/createApp";
import { FakeDecisionProvider } from "../app/integrations/jev/fake";
import { DemoShopifyAdapter } from "../app/integrations/shopify/demo";
import { OrderClarityRuntime } from "../app/services/runtime";
import { computeShopifyHmac } from "../app/domain/hmac";
import type { ShopifyOrder, StaffRole } from "../app/domain/types";
import { BRACELET_PRODUCT } from "../app/demo/fixtures";

export function testRuntime(opts?: { provider?: FakeDecisionProvider; shopify?: DemoShopifyAdapter }) {
  const shopify = opts?.shopify ?? new DemoShopifyAdapter();
  const provider = opts?.provider ?? new FakeDecisionProvider();
  const runtime = new OrderClarityRuntime({
    shopify,
    provider,
    config: {
      mode: "demo",
      shopifySecret: "test-secret",
      encryptionKey: "test-encryption-key-not-for-production",
      allowTestAuth: true,
      demoLabel: true,
    },
  });
  return { runtime, shopify, provider, app: createHttpApp(runtime) };
}

export function sessionHeader(shopId: string, staffId: string | null, role?: StaffRole): string {
  return JSON.stringify({ shopId, staffId, role });
}

export function authHeaders(shopId: string, staffId: string | null, role?: StaffRole): HeadersInit {
  return {
    "x-orderclarity-test-session": sessionHeader(shopId, staffId, role),
    "content-type": "application/json",
  };
}

export function prepareShop(
  runtime: OrderClarityRuntime,
  domain: string,
  opts?: { entitlement?: number },
) {
  const shop = runtime.store.createShop({
    domain,
    webhookSecret: "test-secret",
    selectedProductGids: [BRACELET_PRODUCT, "gid://shopify/Product/necklace"],
    onboardingStep: "activate",
  });
  runtime.store.createUser({
    shopId: shop.id,
    verifiedStaffId: `${domain}-owner`,
    role: "owner",
    active: true,
    displayName: "Owner",
  });
  runtime.store.createUser({
    shopId: shop.id,
    verifiedStaffId: `${domain}-reviewer`,
    role: "reviewer",
    active: true,
    displayName: "Reviewer",
  });
  runtime.store.createUser({
    shopId: shop.id,
    verifiedStaffId: `${domain}-viewer`,
    role: "viewer",
    active: true,
    displayName: "Viewer",
  });
  const mapping = familyMapping(shop.id);
  runtime.store.upsertMapping(mapping);
  runtime.store.upsertRules(familyRules(shop.id));
  const sub = runtime.ensureSubscription(shop.id);
  if (opts?.entitlement) sub.entitlement = opts.entitlement;
  return shop;
}

export async function ingest(runtime: OrderClarityRuntime, shopId: string, order: ShopifyOrder) {
  runtime.seedShopifyOrder(order);
  const shop = runtime.store.getShop(shopId)!;
  runtime.store.enqueueJob({
    type: "evaluate_order",
    shopId,
    installationGeneration: shop.installationGeneration,
    orderGid: order.orderGid,
    payload: {},
    runAfter: Date.now(),
    attempts: 0,
    leasedUntil: null,
    status: "queued",
  });
  await runtime.drain();
  return runtime.store.getOrder(shopId, order.orderGid);
}

export function signedWebhook(
  body: unknown,
  extra?: { eventId?: string; topic?: string; domain?: string; secret?: string },
): { raw: Buffer; headers: Headers } {
  const raw = Buffer.from(JSON.stringify(body));
  const secret = extra?.secret ?? "test-secret";
  const headers = new Headers({
    "x-shopify-hmac-sha256": computeShopifyHmac(raw, secret),
    "x-shopify-shop-domain": extra?.domain ?? "shop-a.example",
    "x-shopify-topic": extra?.topic ?? "orders/create",
    "x-shopify-event-id": extra?.eventId ?? "evt-1",
    "x-shopify-webhook-id": extra?.eventId ?? "wh-1",
    "content-type": "application/json",
  });
  return { raw, headers };
}

export { shopifyOrder, BRACELET_PRODUCT };
