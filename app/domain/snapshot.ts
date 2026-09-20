import { sourceRefPath } from "./text";
import { resolveLinePolicy } from "./rules";
import type {
  LineItemSnapshot,
  MappedAttribute,
  OrderSnapshot,
  ProductMapping,
  RuleSet,
  ShopifyOrder,
} from "./types";

export function buildSnapshot(args: {
  shopId: string;
  installationGeneration: number;
  order: ShopifyOrder;
  mapping: ProductMapping;
  rules: RuleSet;
  observedAt?: string;
  selectedProductGids: string[];
}): OrderSnapshot {
  const selected = new Set(args.selectedProductGids);
  const items: LineItemSnapshot[] = args.order.lineItems.map((line) => {
    const inSelection = selected.has(line.productGid);
    const keyCounts = new Map<string, number>();
    const mappedAttributes: MappedAttribute[] = [];
    for (const attr of line.customAttributes) {
      const occurrenceIndex = keyCounts.get(attr.key) ?? 0;
      keyCounts.set(attr.key, occurrenceIndex + 1);
      const mapping = args.mapping.entries.find((e) => e.sourceKey === attr.key);
      const fieldRole = mapping?.fieldRole ?? "ignored";
      const roleName = mapping?.roleName ?? attr.key;
      mappedAttributes.push({
        sourceRef: sourceRefPath(line.lineItemGid, attr.key, occurrenceIndex),
        sourceKey: attr.key,
        occurrenceIndex,
        fieldRole,
        roleName,
        rawValue: attr.value,
      });
    }
    const policy = resolveLinePolicy(args.rules, line.productGid);
    let applicability: LineItemSnapshot["applicability"] = "unsupported";
    if (!inSelection) {
      applicability = "unsupported";
    } else {
      const requiredMapped = policy.requiredRoles.every((role) =>
        args.mapping.entries.some(
          (e) => e.roleName === role && e.fieldRole === "personalization_content",
        ),
      );
      applicability = requiredMapped ? "applicable" : "unmapped";
    }
    return {
      lineItemGid: line.lineItemGid,
      productGid: line.productGid,
      variantGid: line.variantGid,
      title: line.title,
      selectedOptions: line.selectedOptions,
      quantity: line.quantity,
      mappedAttributes,
      applicability,
      policy,
    };
  });

  const relevant = items.filter((i) => selected.has(i.productGid));
  const mappingComplete = relevant.length > 0 && relevant.every((i) => i.applicability === "applicable");

  return {
    schemaVersion: 1,
    shopId: args.shopId,
    installationGeneration: args.installationGeneration,
    orderGid: args.order.orderGid,
    displayNumber: args.order.displayNumber,
    shopifyUpdatedAt: args.order.updatedAt,
    observedAt: args.observedAt ?? new Date().toISOString(),
    cancelled: args.order.cancelled,
    fulfillmentSummary: args.order.fulfillmentSummary,
    originalNote: args.order.note,
    shopifyTags: args.order.tags,
    items,
    mappingVersion: args.mapping.version,
    ruleVersion: args.rules.version,
    mappingComplete,
    paginationComplete: args.order.paginationComplete,
    customerId: args.order.customerId,
  };
}
