import type { ReasonCode } from "./types";
import { LABEL_NO_ISSUE, LABEL_UNCHECKED } from "./constants";

export const REASON_LABELS: Record<ReasonCode, string> = {
  variant_conflict: "Variant conflict",
  personalization_conflict: "Personalization conflict",
  missing_information: "Missing information",
  ambiguous_assignment: "Ambiguous assignment",
  unsupported_request: "Possible unsupported request",
  gift_content: "Gift content",
  length_exceeded: "Text length exceeded",
  invalid_option: "Selected value not allowed",
  structured_assignment: "Structured assignment issue",
  unchecked_unmapped: "Unchecked — mapped source missing",
  unchecked_limit: "Unchecked — payload or item limit",
  unchecked_provider: "Unchecked — provider failure",
  unchecked_language: "Unchecked — unsupported operational language",
  unchecked_plan_limit: "Unchecked due to plan limit",
  unchecked_pagination: "Unchecked — incomplete order data",
  unchecked_auth: "Unchecked — reconnect required",
  incomplete_coverage: "Incomplete coverage",
};

export function reasonLabel(code: ReasonCode | null | undefined, fallback?: string): string {
  if (!code) return fallback ?? LABEL_NO_ISSUE;
  return REASON_LABELS[code] ?? fallback ?? LABEL_UNCHECKED;
}

export function explanationFromTemplate(
  templateId: string,
  evidence: Record<string, string>,
): string {
  switch (templateId) {
    case "det01_missing":
      return `Required ${evidence.role ?? "field"} is empty. Source: ${evidence.sourceRef ?? ""}.`;
    case "det02_length":
      return `Text length ${evidence.count} exceeds limit ${evidence.limit} on ${evidence.sourceRef ?? "field"}.`;
    case "det03_option":
      return `Selected ${evidence.optionName ?? "option"} "${evidence.selected}" is not in the configured set from ${evidence.provenance ?? "rules"}.`;
    case "det04_structured":
      return evidence.detail ?? "Structured assignments are incomplete or duplicated.";
    case "sem01_conflict":
      return `Personalization "${evidence.original ?? ""}" conflicts with operational request "${evidence.request ?? ""}".`;
    case "sem02_conflict":
      return `Purchased ${evidence.optionName ?? "option"} "${evidence.selected ?? ""}" conflicts with request "${evidence.request ?? ""}".`;
    case "sem03_unsupported":
      return `Request "${evidence.request ?? ""}" is not in the configured surfaces (${evidence.surfaces ?? ""}).`;
    case "sem03_uncertain":
      return `Request "${evidence.request ?? ""}" cannot be confirmed against a missing surface policy.`;
    case "sem04_ambiguous":
      return `Free text does not clearly assign content to items: ${evidence.request ?? ""}.`;
    case "sem05_mixed":
      return `Gift content also contains an operational instruction.`;
    default:
      return evidence.detail ?? reasonLabel(evidence.reasonCode as ReasonCode);
  }
}
