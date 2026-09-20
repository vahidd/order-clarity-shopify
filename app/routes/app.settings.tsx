import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { embeddedAuth } from "../server/embedded-auth.server";
import { APP_TAGS } from "../domain/constants";
import { canConfigure } from "../domain/roles";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  const shop = await runtime.store.getShop(auth.shopId);
  return { mode: shop?.mode ?? "observation", tags: APP_TAGS, canConfigure: canConfigure(auth.role), role: auth.role };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  const form = await request.formData();
  const mode = String(form.get("mode") || "observation");
  const confirmed = String(form.get("confirmTags") || "") === "yes" ? [...APP_TAGS] : undefined;
  return runtime.setMode(auth, mode as "observation" | "assisted_review", confirmed);
};

export default function Settings() {
  const { mode, tags, canConfigure: allow, role } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Settings">
      <s-paragraph>Signed in as {role}. Current mode: {mode}. Observation creates internal findings only and writes no order tags.</s-paragraph>
      <s-paragraph>Assisted review requires owner confirmation of tags: {tags.join(", ")}.</s-paragraph>
      {allow ? (
        <Form method="post">
          <s-select name="mode" label="Mode">
            <s-option value="observation">Observation</s-option>
            <s-option value="assisted_review">Assisted review</s-option>
          </s-select>
          <s-checkbox name="confirmTags" value="yes" label="I confirm the tags that will be written" />
          <s-button type="submit">Save mode</s-button>
        </Form>
      ) : (
        <s-paragraph>Only the owner can change operating mode.</s-paragraph>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
