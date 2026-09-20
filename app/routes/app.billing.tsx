import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { embeddedAuth } from "../server/embedded-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  return runtime.usage(auth);
};

export default function Billing() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Billing">
      <s-paragraph>
        Plan {data.plan}: {data.consumed} / {data.entitlement} counted orders this cycle ({data.cycleStart} – {data.cycleEnd}).
      </s-paragraph>
      <s-paragraph>Status: {data.status}. Existing reviews remain available when scanning is paused. No automatic overage billing.</s-paragraph>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
