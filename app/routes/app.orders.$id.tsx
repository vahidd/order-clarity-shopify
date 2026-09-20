import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { embeddedAuth } from "../server/embedded-auth.server";
import { LABEL_NO_ISSUE } from "../domain/constants";
import { canReview } from "../domain/roles";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  if (!params.id) throw new Response("Not found", { status: 404 });
  const detail = await runtime.orderDetail(auth, params.id);
  if (!detail) throw new Response("Not found", { status: 404 });
  return { ...detail, canMutate: canReview(auth.role), role: auth.role };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  const form = await request.formData();
  const findingId = String(form.get("findingId") ?? "");
  const result = await runtime.resolveFinding(auth, findingId, {
    action: String(form.get("action") ?? "mark_reviewed") as "mark_reviewed",
    evaluationId: String(form.get("evaluationId") ?? ""),
    rowVersion: Number(form.get("rowVersion")),
    note: String(form.get("note") ?? ""),
    resolutionCategory: String(form.get("resolutionCategory") ?? ""),
    dismissReason: String(form.get("dismissReason") ?? ""),
  });
  if (result.status !== 200) {
    throw new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  }
  return { ok: true, id: params.id };
};

export default function OrderDetail() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading={data.order.displayNumber}>
      <s-paragraph>{data.disclaimer}</s-paragraph>
      <s-paragraph>Signed in as {data.role}. Unidentified staff cannot mutate.</s-paragraph>
      <s-section heading="Original order note">
        <s-paragraph>{data.snapshot?.originalNote || "—"}</s-paragraph>
      </s-section>
      {(data.snapshot?.items ?? []).map((item) => (
        <s-section key={item.lineItemGid} heading={`${item.title} × ${item.quantity}`}>
          <s-paragraph>Variant: {JSON.stringify(item.selectedOptions)}</s-paragraph>
          <s-paragraph>Mapped attributes: {JSON.stringify(item.mappedAttributes)}</s-paragraph>
        </s-section>
      ))}
      <s-section heading="Findings">
        {data.findings.length === 0 ? <s-paragraph>{LABEL_NO_ISSUE}</s-paragraph> : null}
        {data.findings.map((finding) => (
          <s-box key={finding.id} padding="base" border="base">
            <s-heading>{finding.reasonLabel}</s-heading>
            <s-paragraph>
              {finding.checkId} · {finding.method} · {finding.state}
            </s-paragraph>
            {data.canMutate ? (
              <Form method="post">
                <input type="hidden" name="findingId" value={finding.id} />
                <input type="hidden" name="evaluationId" value={String(data.order.evaluationId ?? "")} />
                <input type="hidden" name="rowVersion" value={String(finding.rowVersion)} />
                <s-select name="action" label="Action">
                  <s-option value="mark_reviewed">Mark reviewed</s-option>
                  <s-option value="awaiting_customer">Awaiting customer</s-option>
                  <s-option value="dismiss">Dismiss finding</s-option>
                  <s-option value="reopen">Reopen</s-option>
                </s-select>
                <s-text-field name="resolutionCategory" label="Resolution category" />
                <s-text-field name="dismissReason" label="Dismiss reason" />
                <s-text-area name="note" label="Note" />
                <s-button type="submit">Submit</s-button>
              </Form>
            ) : (
              <s-paragraph>Review actions are disabled for this role.</s-paragraph>
            )}
          </s-box>
        ))}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
