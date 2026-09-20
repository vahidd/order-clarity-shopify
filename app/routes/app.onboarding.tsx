import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { embeddedAuth } from "../server/embedded-auth.server";
import { canConfigure } from "../domain/roles";

const STEPS = ["install", "choose_products", "map_fields", "define_rules", "review_sample", "activate"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  return { ...(await runtime.getOnboarding(auth)), canConfigure: canConfigure(auth.role), role: auth.role };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "products") {
    return runtime.chooseProducts(auth, {
      productGids: String(form.get("productGids") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  if (intent === "complete") {
    return runtime.completeOnboarding(auth);
  }
  return { status: 400, body: { error: "unknown_intent" } };
};

export default function Onboarding() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Onboarding">
      <s-ordered-list>
        {STEPS.map((s) => (
          <s-list-item key={s}>
            {s.replaceAll("_", " ")}
            {s === data.step ? " (current)" : ""}
          </s-list-item>
        ))}
      </s-ordered-list>
      <s-paragraph>Role: {data.role}. Progress is saved so you can resume.</s-paragraph>
      {data.canConfigure ? (
        <>
          <s-section heading="1. Choose products">
            <Form method="post">
              <input type="hidden" name="intent" value="products" />
              <s-text-field name="productGids" label="Product GIDs (comma-separated)" />
              <s-button type="submit">Save products</s-button>
            </Form>
          </s-section>
          <s-section heading="Activate">
            <Form method="post">
              <input type="hidden" name="intent" value="complete" />
              <s-button type="submit">Mark onboarding activated</s-button>
            </Form>
          </s-section>
        </>
      ) : (
        <s-paragraph>Only the owner can change onboarding.</s-paragraph>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
