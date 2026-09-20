import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { redirect } from "react-router";

export const loader = () => redirect("/app/settings");

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
