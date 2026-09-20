import { ADMIN_API_VERSION } from "../../domain/constants";
import type { ShopifyAdapter, ShopifyOrder } from "../../domain/types";

const ORDER_QUERY = `#graphql
  query OrderClarityOrder($id: ID!, $cursor: String) {
    order(id: $id) {
      id
      name
      updatedAt
      cancelledAt
      note
      tags
      displayFulfillmentStatus
      customer { id }
      lineItems(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          title
          quantity
          customAttributes { key value }
          variant {
            id
            selectedOptions { name value }
          }
          product { id }
        }
      }
    }
  }
`;

const TAGS_ADD = `#graphql
  mutation OrderClarityTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

const TAGS_REMOVE = `#graphql
  mutation OrderClarityTagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

export type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<{ json: () => Promise<unknown> }>;

export class ShopifyAdminAdapter implements ShopifyAdapter {
  readonly kind = "live" as const;
  readonly apiVersion = ADMIN_API_VERSION;

  constructor(
    private readonly graphql: AdminGraphql,
    private readonly graphqlForShop?: (shopId: string) => Promise<AdminGraphql> | AdminGraphql,
  ) {}

  private async client(shopId: string): Promise<AdminGraphql> {
    if (this.graphqlForShop) return await this.graphqlForShop(shopId);
    return this.graphql;
  }

  async fetchOrder(shopId: string, orderGid: string): Promise<ShopifyOrder | null> {
    const lineItems: ShopifyOrder["lineItems"] = [];
    let cursor: string | null = null;
    let pageInfo = { hasNextPage: true, endCursor: null as string | null };
    let header: {
      id: string;
      name: string;
      updatedAt: string;
      cancelledAt: string | null;
      note: string | null;
      tags: string[];
      displayFulfillmentStatus: string | null;
      customer: { id: string } | null;
    } | null = null;

    while (pageInfo.hasNextPage) {
      const graphql = await this.client(shopId);
      const response = await graphql(ORDER_QUERY, { variables: { id: orderGid, cursor } });
      const json = (await response.json()) as {
        errors?: unknown;
        data?: {
          order?: {
            id: string;
            name: string;
            updatedAt: string;
            cancelledAt: string | null;
            note: string | null;
            tags: string[];
            displayFulfillmentStatus: string | null;
            customer: { id: string } | null;
            lineItems: {
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
              nodes: Array<{
                id: string;
                title: string;
                quantity: number;
                customAttributes: Array<{ key: string; value: string }>;
                variant: { id: string; selectedOptions: Array<{ name: string; value: string }> } | null;
                product: { id: string } | null;
              }>;
            };
          } | null;
        };
      };
      if (json.errors || !json.data?.order) {
        return header
          ? {
              orderGid,
              displayNumber: header.name,
              updatedAt: header.updatedAt,
              cancelled: Boolean(header.cancelledAt),
              note: header.note ?? "",
              tags: header.tags,
              customerId: header.customer?.id ?? null,
              fulfillmentSummary: header.displayFulfillmentStatus ?? "",
              lineItems,
              paginationComplete: false,
            }
          : null;
      }
      const order = json.data.order;
      header = order;
      for (const node of order.lineItems.nodes) {
        const selectedOptions: Record<string, string> = {};
        for (const opt of node.variant?.selectedOptions ?? []) {
          selectedOptions[opt.name.toLowerCase()] = opt.value;
        }
        lineItems.push({
          lineItemGid: node.id,
          productGid: node.product?.id ?? "",
          variantGid: node.variant?.id ?? "",
          title: node.title,
          quantity: node.quantity,
          selectedOptions,
          customAttributes: node.customAttributes ?? [],
        });
      }
      pageInfo = order.lineItems.pageInfo;
      cursor = pageInfo.endCursor;
      if (!pageInfo.hasNextPage) break;
    }

    if (!header) return null;
    return {
      orderGid: header.id,
      displayNumber: header.name,
      updatedAt: header.updatedAt,
      cancelled: Boolean(header.cancelledAt),
      note: header.note ?? "",
      tags: header.tags,
      customerId: header.customer?.id ?? null,
      fulfillmentSummary: header.displayFulfillmentStatus ?? "",
      lineItems,
      paginationComplete: true,
    };
  }

  async addTags(shopId: string, orderGid: string, tags: string[]) {
    if (tags.length === 0) return { ok: true };
    try {
      const graphql = await this.client(shopId);
      const response = await graphql(TAGS_ADD, { variables: { id: orderGid, tags } });
      const json = (await response.json()) as { data?: { tagsAdd?: { userErrors: Array<{ message: string }> } } };
      const errors = json.data?.tagsAdd?.userErrors ?? [];
      if (errors.length) return { ok: false, error: errors.map((e) => e.message).join("; ") };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "tagsAdd failed" };
    }
  }

  async removeTags(shopId: string, orderGid: string, tags: string[]) {
    if (tags.length === 0) return { ok: true };
    try {
      const graphql = await this.client(shopId);
      const response = await graphql(TAGS_REMOVE, { variables: { id: orderGid, tags } });
      const json = (await response.json()) as { data?: { tagsRemove?: { userErrors: Array<{ message: string }> } } };
      const errors = json.data?.tagsRemove?.userErrors ?? [];
      if (errors.length) return { ok: false, error: errors.map((e) => e.message).join("; ") };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "tagsRemove failed" };
    }
  }
}
