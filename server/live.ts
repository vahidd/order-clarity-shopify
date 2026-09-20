import { loadConfig } from "../app/config";

try {
  process.env.APP_MODE = process.env.APP_MODE || "live";
  loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

console.error("Start the live embedded app with `npm run start` after `npm run setup` and Shopify CLI auth.");
process.exit(1);
