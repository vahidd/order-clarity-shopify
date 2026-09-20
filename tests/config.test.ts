import { describe, expect, it } from "vitest";
import { loadConfig } from "../app/config";

describe("configuration", () => {
  it("refuses live mode without secrets and does not fall back to demo", () => {
    expect(() =>
      loadConfig({
        APP_MODE: "live",
      } as NodeJS.ProcessEnv),
    ).toThrow(/Live mode configuration error/);
    expect(() =>
      loadConfig({
        APP_MODE: "live",
      } as NodeJS.ProcessEnv),
    ).toThrow(/not falling back to demo/);
  });

  it("requires an explicit APP_MODE", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/APP_MODE must be set/);
  });

  it("allows demo without Shopify or TypeSafe credentials", () => {
    const config = loadConfig({ APP_MODE: "demo" } as NodeJS.ProcessEnv);
    expect(config.mode).toBe("demo");
  });
});
