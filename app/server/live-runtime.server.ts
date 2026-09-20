import { loadConfig } from "../config";
import { FakeDecisionProvider } from "../integrations/jev/fake";
import { DemoShopifyAdapter } from "../integrations/shopify/demo";
import { PrismaStore } from "../repositories/prisma";
import { OrderClarityRuntime } from "../services/runtime";
import { createLiveRuntime } from "./create-live-runtime";

let runtime: OrderClarityRuntime | null = null;
let liveReady: Promise<OrderClarityRuntime> | null = null;

export async function getLiveRuntime(): Promise<OrderClarityRuntime> {
  if (runtime) return runtime;
  if (liveReady) return liveReady;
  liveReady = boot();
  runtime = await liveReady;
  return runtime;
}

async function boot(): Promise<OrderClarityRuntime> {
  const mode = process.env.APP_MODE === "demo" ? "demo" : "live";
  if (mode !== "live") {
    return new OrderClarityRuntime({
      shopify: new DemoShopifyAdapter(),
      provider: new FakeDecisionProvider(),
      config: {
        mode: "demo",
        shopifySecret: process.env.SHOPIFY_API_SECRET || "demo-webhook-secret",
        encryptionKey: process.env.ORDERCLARITY_ENCRYPTION_KEY || "demo-encryption-key-not-for-production",
        allowTestAuth: true,
        demoLabel: true,
      },
    });
  }

  const config = loadConfig({ ...process.env, APP_MODE: "live" });
  const [{ default: prisma }, { unauthenticated }] = await Promise.all([
    import("../db.server"),
    import("../shopify.server"),
  ]);
  const store = new PrismaStore(prisma, config.encryptionKey);
  return createLiveRuntime({
    config,
    store,
    graphqlForShop: async (shopId) => {
      const shop = await store.getShop(shopId);
      if (!shop) throw new Error("unknown shop for Admin GraphQL");
      const { admin } = await unauthenticated.admin(shop.domain);
      return async (query, options) => {
        const res = await admin.graphql(query, options);
        return { json: () => res.json() };
      };
    },
  });
}

export function getLiveRuntimeSync(): OrderClarityRuntime {
  if (!runtime) {
    throw new Error("getLiveRuntime() must be awaited before getLiveRuntimeSync()");
  }
  return runtime;
}
