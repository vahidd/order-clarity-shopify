import { createServer } from "node:http";
import { loadConfig } from "../app/config";
import { seedDemo } from "../app/demo/seed";
import { createHttpApp } from "../app/http/createApp";
import { FakeDecisionProvider } from "../app/integrations/jev/fake";
import { DemoShopifyAdapter } from "../app/integrations/shopify/demo";
import { OrderClarityRuntime } from "../app/services/runtime";

async function main() {
  process.env.APP_MODE = process.env.APP_MODE || "demo";
  const config = loadConfig();
  if (config.mode !== "demo") {
    throw new Error("server/demo.ts only runs APP_MODE=demo");
  }

  const runtime = new OrderClarityRuntime({
    shopify: new DemoShopifyAdapter(),
    provider: new FakeDecisionProvider(),
    config: {
      mode: "demo",
      shopifySecret: config.shopifyApiSecret,
      encryptionKey: config.encryptionKey,
      allowTestAuth: true,
      demoLabel: true,
    },
  });
  await seedDemo(runtime);
  const app = createHttpApp(runtime);

  const server = createServer(async (req, res) => {
    const host = req.headers.host || `127.0.0.1:${config.port}`;
    const url = new URL(req.url || "/", `http://${host}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) headers.set(key, value.join(", "));
      else if (value) headers.set(key, value);
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = await app.fetch(request);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  });

  server.listen(config.port, "127.0.0.1", () => {
    console.log(`OrderClarity demo listening on http://127.0.0.1:${config.port}`);
    console.log("Demo mode: synthetic data, Observation default, Shopify mutations blocked from live.");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
