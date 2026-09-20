export type LoadedConfig = {
  mode: "demo" | "live";
  port: number;
  shopifyApiKey?: string;
  shopifyApiSecret: string;
  shopifyAppUrl?: string;
  databaseUrl?: string;
  redisUrl?: string;
  typesafeApiKey?: string;
  jevModel: string;
  encryptionKey: string;
  sessionSecret?: string;
  adminApiVersion: string;
};

const LIVE_REQUIRED = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "DATABASE_URL",
  "TYPESAFE_API_KEY",
  "ORDERCLARITY_ENCRYPTION_KEY",
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const mode = env.APP_MODE;
  if (mode !== "demo" && mode !== "live") {
    throw new Error("APP_MODE must be set to 'demo' or 'live'. Live mode never falls back to demo.");
  }
  if (mode === "live") {
    const missing = LIVE_REQUIRED.filter((key) => !env[key]);
    if (missing.length) {
      throw new Error(
        `Live mode configuration error: missing ${missing.join(", ")}. Refusing to start and not falling back to demo.`,
      );
    }
  }
  return {
    mode,
    port: Number(env.PORT || 3000),
    shopifyApiKey: env.SHOPIFY_API_KEY,
    shopifyApiSecret: env.SHOPIFY_API_SECRET || (mode === "demo" ? "demo-webhook-secret" : ""),
    shopifyAppUrl: env.SHOPIFY_APP_URL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    typesafeApiKey: env.TYPESAFE_API_KEY,
    jevModel: env.JEV_MODEL || "jev-latest",
    encryptionKey: env.ORDERCLARITY_ENCRYPTION_KEY || (mode === "demo" ? "demo-encryption-key-not-for-production" : ""),
    sessionSecret: env.SESSION_SECRET,
    adminApiVersion: env.SHOPIFY_API_VERSION || "2026-07",
  };
}
