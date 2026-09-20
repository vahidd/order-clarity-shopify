import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getLiveRuntime } from "../server/live-runtime.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  const runtime = await getLiveRuntime();
  const row = runtime.store.getShopByDomain(shop);
  if (row) await runtime.uninstall(row.id);
  return new Response();
};
