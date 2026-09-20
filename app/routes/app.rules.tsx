import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { embeddedAuth } from "../server/embedded-auth.server";
import { canConfigure } from "../domain/roles";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  return {
    rules: await runtime.store.listRules(auth.shopId),
    canConfigure: canConfigure(auth.role),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "draft");
  if (intent === "preview") {
    return runtime.previewRules(auth, String(form.get("ruleId")));
  }
  if (intent === "activate") {
    return runtime.activateRules(auth, String(form.get("ruleId")));
  }
  return runtime.saveRuleDraft(auth, {
    requiredRoles: ["engraving"],
    maxGraphemes: Number(form.get("maxGraphemes") || 20),
    surfaces: String(form.get("surfaces") || "front")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });
};

export default function Rules() {
  const { rules, canConfigure: allow } = useLoaderData<typeof loader>();
  const latest = rules[rules.length - 1];
  return (
    <s-page heading="Rules">
      <s-paragraph>
        Draft, validate, and activate. Active versions are immutable. Preview runs evaluation without activating or
        writing tags.
      </s-paragraph>
      {allow ? (
        <>
          <Form method="post">
            <input type="hidden" name="intent" value="draft" />
            <s-text-field name="maxGraphemes" label="Max graphemes" value="20" />
            <s-text-field name="surfaces" label="Surfaces" value="front" />
            <s-button type="submit">Save draft</s-button>
          </Form>
          {latest ? (
            <>
              <Form method="post">
                <input type="hidden" name="intent" value="preview" />
                <input type="hidden" name="ruleId" value={latest.id} />
                <s-button type="submit">Preview sample</s-button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="activate" />
                <input type="hidden" name="ruleId" value={latest.id} />
                <s-button type="submit">Activate version</s-button>
              </Form>
            </>
          ) : null}
        </>
      ) : null}
      <s-box padding="base" border="base">
        <pre>{JSON.stringify(rules, null, 2)}</pre>
      </s-box>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
