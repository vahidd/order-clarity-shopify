import { familyMapping, familyRules, scenarioOrders } from "./fixtures";
import type { OrderClarityRuntime } from "../services/runtime";

export async function seedDemo(runtime: OrderClarityRuntime, shopDomain = "demo-shop.example") {
  const shop =
    runtime.store.getShopByDomain(shopDomain) ??
    runtime.store.createShop({
      domain: shopDomain,
      mode: "observation",
      onboardingStep: "activate",
      selectedProductGids: familyMapping("pending").productGids,
      webhookSecret: runtime.config.shopifySecret,
    });
  shop.selectedProductGids = familyMapping(shop.id).productGids;
  shop.onboardingStep = "activate";
  shop.mode = "observation";

  runtime.store.createUser({
    shopId: shop.id,
    verifiedStaffId: "demo-owner",
    role: "owner",
    active: true,
    displayName: "Demo Owner",
  });
  runtime.store.createUser({
    shopId: shop.id,
    verifiedStaffId: "demo-reviewer",
    role: "reviewer",
    active: true,
    displayName: "Demo Reviewer",
  });
  runtime.store.createUser({
    shopId: shop.id,
    verifiedStaffId: "demo-viewer",
    role: "viewer",
    active: true,
    displayName: "Demo Viewer",
  });

  const mapping = familyMapping(shop.id);
  mapping.status = "active";
  runtime.store.upsertMapping(mapping);
  const rules = familyRules(shop.id);
  rules.status = "active";
  runtime.store.upsertRules(rules);
  runtime.ensureSubscription(shop.id);

  for (const order of scenarioOrders) {
    runtime.seedShopifyOrder(order);
    runtime.store.enqueueJob({
      type: "evaluate_order",
      shopId: shop.id,
      installationGeneration: shop.installationGeneration,
      orderGid: order.orderGid,
      payload: { seed: true },
      runAfter: Date.now(),
      attempts: 0,
      leasedUntil: null,
      status: "queued",
    });
  }
  await runtime.drain(100);
  return shop;
}
