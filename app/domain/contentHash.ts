import { createHash } from "node:crypto";
import { APP_TAGS } from "./constants";
import type { OrderSnapshot } from "./types";
import { compareKey } from "./text";

export function canonicalContentHash(input: {
  snapshot: OrderSnapshot;
  mappingVersion: string;
  ruleVersion: string;
  promptVersion: string;
}): string {
  const { snapshot } = input;
  const tags = snapshot.shopifyTags.filter((t) => !APP_TAGS.includes(t as (typeof APP_TAGS)[number]));
  const payload = {
    orderGid: snapshot.orderGid,
    note: compareKey(snapshot.originalNote),
    cancelled: snapshot.cancelled,
    mappingVersion: input.mappingVersion,
    ruleVersion: input.ruleVersion,
    promptVersion: input.promptVersion,
    mappingComplete: snapshot.mappingComplete,
    paginationComplete: snapshot.paginationComplete,
    tags,
    items: snapshot.items.map((item) => ({
      lineItemGid: item.lineItemGid,
      productGid: item.productGid,
      variantGid: item.variantGid,
      quantity: item.quantity,
      selectedOptions: item.selectedOptions,
      applicability: item.applicability,
      attributes: item.mappedAttributes.map((a) => ({
        sourceRef: a.sourceRef,
        sourceKey: a.sourceKey,
        occurrenceIndex: a.occurrenceIndex,
        fieldRole: a.fieldRole,
        roleName: a.roleName,
        value: a.rawValue,
      })),
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
