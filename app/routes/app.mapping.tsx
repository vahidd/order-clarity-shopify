import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { embeddedAuth } from "../server/embedded-auth.server";
import { canConfigure } from "../domain/roles";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  return {
    mappings: await runtime.store.listMappings(auth.shopId),
    canConfigure: canConfigure(auth.role),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { runtime, auth } = await embeddedAuth(request);
  const form = await request.formData();
  return runtime.saveMapping(auth, {
    id: String(form.get("id") || ""),
    shopId: auth.shopId,
    scope: String(form.get("scope") || "engraved-gifts"),
    version: String(form.get("version") || ""),
    status: "draft",
    productGids: String(form.get("productGids") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    collectionGid: null,
    entries: [
      {
        sourceKey: String(form.get("sourceKey") || "Engraving"),
        fieldRole: "personalization_content",
        roleName: String(form.get("roleName") || "engraving"),
      },
    ],
    createdAt: new Date().toISOString(),
  });
};

export default function Mapping() {
  const { mappings, canConfigure: allow } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Field mapping">
      <s-paragraph>
        Map source keys to personalization content, operational request, gift message, selected option, or ignored.
        Repeated keys are stored as ordered entries.
      </s-paragraph>
      {allow ? (
        <Form method="post">
          <s-text-field name="productGids" label="Product GIDs" />
          <s-text-field name="sourceKey" label="Source key" value="Engraving" />
          <s-text-field name="roleName" label="Role name" value="engraving" />
          <s-button type="submit">Save draft mapping</s-button>
        </Form>
      ) : null}
      <s-box padding="base" border="base">
        <pre>{JSON.stringify(mappings, null, 2)}</pre>
      </s-box>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
