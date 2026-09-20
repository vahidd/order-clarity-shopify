import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { embeddedAuth } from "../server/embedded-auth.server";
import { LABEL_NO_ISSUE } from "../domain/constants";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  return runtime.overview(auth);
};

export default function Overview() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Overview">
      {data.demo ? <s-banner tone="warning">Demo — synthetic data. Shopify mutations cannot reach a live shop.</s-banner> : null}
      <s-section heading="Status">
        <s-paragraph>Operating mode: {data.operatingMode}. Default is Observation (no order tags).</s-paragraph>
        <s-paragraph>Onboarding: {data.onboardingStep}</s-paragraph>
        <s-paragraph>Detected issues are separate from integration failures. Interface copy uses {LABEL_NO_ISSUE}.</s-paragraph>
      </s-section>
      <s-section heading="Counts">
        <s-stack>
          <s-text>Unresolved issues: {data.unresolvedIssues}</s-text>
          <s-text>Unchecked / integration failures: {data.uncheckedOrders}</s-text>
          <s-text>Processing backlog: {data.processingBacklog}</s-text>
          <s-text>
            Usage: {data.usage.consumed} / {data.usage.entitlement}
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
