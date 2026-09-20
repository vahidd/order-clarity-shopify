import type { ActionFunctionArgs } from "react-router";
import { getLiveRuntime } from "../server/live-runtime.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const runtime = await getLiveRuntime();
  const raw = Buffer.from(await request.arrayBuffer());
  const result = await runtime.handleWebhook(raw, request.headers);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json" },
  });
};
