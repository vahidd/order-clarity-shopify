import type { LoadedConfig } from "../config";
import type { DecisionProvider } from "../domain/types";
import { JevHttpProvider } from "../integrations/jev/http";
import { ShopifyAdminAdapter, type AdminGraphql } from "../integrations/shopify/admin";
import { OrderClarityRuntime } from "../services/runtime";
import type { MemoryStore } from "../store/memory";

export function createLiveRuntime(args: {
  config: LoadedConfig;
  store: MemoryStore;
  graphqlForShop: (shopId: string) => Promise<AdminGraphql> | AdminGraphql;
  provider?: DecisionProvider;
}): OrderClarityRuntime {
  const requestGraphql = new Map<string, AdminGraphql>();
  const runtime = new OrderClarityRuntime({
    store: args.store,
    shopify: new ShopifyAdminAdapter(async () => {
      throw new Error("Live ShopifyAdminAdapter requires shop-scoped Admin GraphQL");
    }, async (shopId) => {
      const shop = await args.store.getShop(shopId);
      if (shop) {
        const bound = requestGraphql.get(shop.domain);
        if (bound) return bound;
      }
      return args.graphqlForShop(shopId);
    }),
    provider:
      args.provider ??
      new JevHttpProvider({
        apiKey: args.config.typesafeApiKey || "",
        model: args.config.jevModel,
      }),
    config: {
      mode: "live",
      shopifySecret: args.config.shopifyApiSecret,
      encryptionKey: args.config.encryptionKey,
      allowTestAuth: false,
      demoLabel: false,
    },
  });
  runtime.bindAdminGraphql = (domain, graphql) => {
    requestGraphql.set(domain, graphql);
  };
  return runtime;
}
