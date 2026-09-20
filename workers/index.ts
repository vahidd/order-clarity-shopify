import { loadConfig } from "../app/config";
import { JevHttpProvider } from "../app/integrations/jev/http";
import { PrismaStore } from "../app/repositories/prisma";
import { createLiveRuntime } from "../app/server/create-live-runtime";

async function main() {
  const config = loadConfig();
  if (config.mode !== "live") {
    throw new Error("workers/index.ts requires APP_MODE=live");
  }
  const [{ default: prisma }, { unauthenticated }] = await Promise.all([
    import("../app/db.server"),
    import("../app/shopify.server"),
  ]);
  const store = new PrismaStore(prisma, config.encryptionKey);
  await store.hydrate();
  const runtime = createLiveRuntime({
    config,
    store,
    provider: new JevHttpProvider({
      apiKey: config.typesafeApiKey!,
      model: config.jevModel,
    }),
    graphqlForShop: async (shopId) => {
      const shop = store.getShop(shopId);
      if (!shop) throw new Error("unknown shop");
      const { admin } = await unauthenticated.admin(shop.domain);
      return async (query, options) => {
        const res = await admin.graphql(query, options);
        return { json: () => res.json() };
      };
    },
  });
  console.log("OrderClarity worker started");
  for (;;) {
    const n = await runtime.drain(10);
    if (n === 0) await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
