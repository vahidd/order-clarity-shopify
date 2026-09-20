import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { embeddedAuth } from "../server/embedded-auth.server";
import { LABEL_NO_ISSUE } from "../domain/constants";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  return runtime.queue(auth, new URL(request.url).searchParams);
};

export default function Queue() {
  const data = useLoaderData<typeof loader>();
  const [, setParams] = useSearchParams();
  return (
    <s-page heading="Review queue">
      <s-stack direction="inline">
        <s-button onClick={() => setParams({ tab: "open" })}>Open issues ({data.counts.open})</s-button>
        <s-button onClick={() => setParams({ tab: "unchecked" })}>Unchecked ({data.counts.unchecked})</s-button>
        <s-button onClick={() => setParams({ tab: "no_issue_detected" })}>{LABEL_NO_ISSUE}</s-button>
      </s-stack>
      <s-section>
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Product</th>
              <th>Primary reason</th>
              <th>Issues</th>
              <th>Review</th>
              <th>Last evaluated</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <s-link href={`/app/orders/${row.id}`}>{row.displayNumber}</s-link>
                </td>
                <td>{row.productSummary}</td>
                <td>{row.primaryReasonLabel}</td>
                <td>{row.issueCount}</td>
                <td>{row.reviewState}</td>
                <td>{row.lastEvaluatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
