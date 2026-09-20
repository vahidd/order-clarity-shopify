import {
  APP_TAG_NEEDS_REVIEW,
  APP_TAG_REVIEWED,
  APP_TAG_UNCHECKED,
  APP_TAGS,
} from "./constants";
import type { OperatingMode, OverallLabel } from "./types";

export function desiredAppTags(args: {
  mode: OperatingMode;
  overallLabel: OverallLabel;
  hasOpenFindings: boolean;
}): { add: string[]; remove: string[] } {
  if (args.mode !== "assisted_review") {
    return { add: [], remove: [...APP_TAGS] };
  }
  let keep: string | null = null;
  if (args.overallLabel === "unchecked" || args.overallLabel === "incomplete") {
    keep = APP_TAG_UNCHECKED;
  } else if (args.hasOpenFindings || args.overallLabel === "issues") {
    keep = APP_TAG_NEEDS_REVIEW;
  } else if (args.overallLabel === "no_issue_detected") {
    keep = APP_TAG_REVIEWED;
  }
  const add = keep ? [keep] : [];
  const remove = APP_TAGS.filter((t) => t !== keep);
  return { add, remove };
}

export function isAppManagedTag(tag: string): boolean {
  return (APP_TAGS as readonly string[]).includes(tag);
}

export function tagsExcludeAppManaged(tags: string[]): string[] {
  return tags.filter((t) => !isAppManagedTag(t));
}

export function outboxActionKey(args: {
  shopId: string;
  orderGid: string;
  revision: number;
  actionType: "add" | "remove";
  tag: string;
}): string {
  return `${args.shopId}:${args.orderGid}:${args.revision}:${args.actionType}:${args.tag}`;
}
