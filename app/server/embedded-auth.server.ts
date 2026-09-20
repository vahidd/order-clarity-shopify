import { authenticate } from "../shopify.server";
import type { AuthContext } from "../domain/types";
import { getLiveRuntime } from "./live-runtime.server";
import type { OrderClarityRuntime } from "../services/runtime";

export async function embeddedAuth(request: Request): Promise<{
  runtime: OrderClarityRuntime;
  auth: AuthContext;
  session: { shop: string };
}> {
  const { session, admin } = await authenticate.admin(request);
  const runtime = await getLiveRuntime();
  const graphql = async (query: string, options?: { variables?: Record<string, unknown> }) => {
    const res = await admin.graphql(query, options);
    return { json: () => res.json() };
  };
  runtime.bindAdminGraphql?.(session.shop, graphql);
  const online = session as {
    shop: string;
    accessToken?: string;
    userId?: string | number | bigint | null;
    accountOwner?: boolean;
    onlineAccessInfo?: { associated_user?: { id?: number | string; account_owner?: boolean } };
  };
  const associated = online.onlineAccessInfo?.associated_user;
  const auth = runtime.ensureTenantFromSession({
    shop: session.shop,
    accessToken: online.accessToken,
    userId: associated?.id ?? online.userId ?? null,
    accountOwner: associated?.account_owner ?? online.accountOwner,
    scope: session.scope,
  });
  await runtime.flush();
  return { runtime, auth, session };
}
