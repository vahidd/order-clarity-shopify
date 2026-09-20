import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { embeddedAuth } from "../server/embedded-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  return { users: runtime.store.listUsers(auth.shopId), role: auth.role };
};

export default function Staff() {
  const { users, role } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Staff access">
      <s-paragraph>Your role: {role}. Roles come from verified Shopify staff identity. Unidentified staff cannot be defaulted to Owner.</s-paragraph>
      <s-unordered-list>
        {users.map((u) => (
          <s-list-item key={u.id}>
            {u.displayName} — {u.role}
          </s-list-item>
        ))}
      </s-unordered-list>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
