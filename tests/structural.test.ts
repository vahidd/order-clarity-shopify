import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_API_VERSION } from "../app/domain/constants";
import { ShopifyAdminAdapter } from "../app/integrations/shopify/admin";
import { JevHttpProvider } from "../app/integrations/jev/http";
import { DemoShopifyAdapter } from "../app/integrations/shopify/demo";
import { FakeDecisionProvider } from "../app/integrations/jev/fake";
import { JEV_ENDPOINT } from "../app/domain/constants";

const screens = [
  "app/routes/app._index.tsx",
  "app/routes/app.queue.tsx",
  "app/routes/app.orders.$id.tsx",
  "app/routes/app.onboarding.tsx",
  "app/routes/app.mapping.tsx",
  "app/routes/app.rules.tsx",
  "app/routes/app.billing.tsx",
  "app/routes/app.staff.tsx",
  "app/routes/app.settings.tsx",
];

describe("P0 structure", () => {
  it("ships overview, queue, detail, onboarding, mapping, rules, billing screens", () => {
    for (const file of screens) {
      expect(existsSync(file), file).toBe(true);
    }
  });

  it("pins Admin API 2026-07 and keeps live adapters distinct from demo", () => {
    expect(ADMIN_API_VERSION).toBe("2026-07");
    expect(JEV_ENDPOINT).toBe("https://api.typesafe.ai/v1/systemone");
    const live = new ShopifyAdminAdapter(async () => ({ json: async () => ({}) }));
    expect(live.kind).toBe("live");
    expect(live.apiVersion).toBe("2026-07");
    expect(new DemoShopifyAdapter().kind).toBe("demo");
    expect(new JevHttpProvider({ apiKey: "test" }).id).toBe("jev");
    expect(new FakeDecisionProvider().id).toBe("fake");
    const adminSrc = readFileSync("app/integrations/shopify/admin.ts", "utf8");
    expect(adminSrc).toContain("tagsAdd");
    expect(adminSrc).toContain("tagsRemove");
    const jevSrc = readFileSync("app/integrations/jev/http.ts", "utf8");
    expect(jevSrc).toContain("AbortController");
    expect(jevSrc).toContain("429");
    const liveRuntime = readFileSync("app/server/live-runtime.server.ts", "utf8");
    expect(liveRuntime).toContain("PrismaStore");
    expect(liveRuntime).toContain("createLiveRuntime");
    const ordersRoute = readFileSync("app/routes/app.orders.$id.tsx", "utf8");
    expect(ordersRoute).toContain("embeddedAuth");
    expect(ordersRoute).not.toContain("shops[0]");
    const persist = readFileSync("app/repositories/prisma.ts", "utf8");
    expect(persist).toContain("persistOrder");
    expect(persist).toContain("persistEvaluation");
    expect(persist).toContain("class PrismaStore");
  });
});
