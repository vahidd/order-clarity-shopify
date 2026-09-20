import type { MappingEntry, ProductMapping, RuleSet } from "./types";

export type ValidationIssue = { field: string; message: string };

export function validateMapping(mapping: Pick<ProductMapping, "entries" | "productGids">): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (mapping.productGids.length === 0) {
    issues.push({ field: "productGids", message: "Select at least one product." });
  }
  mapping.entries.forEach((entry, index) => {
    if (!entry.sourceKey) {
      issues.push({ field: `entries.${index}.sourceKey`, message: "Source key is required." });
    }
  });
  return issues;
}

export function validateRuleSet(rules: RuleSet, mapping?: ProductMapping): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (rules.maxGraphemes !== null && rules.maxGraphemes < 1) {
    issues.push({ field: "maxGraphemes", message: "Grapheme limit must be at least 1 when set." });
  }
  const ignored = new Set(
    (mapping?.entries ?? []).filter((e) => e.fieldRole === "ignored").map((e) => e.roleName),
  );
  for (const role of rules.requiredRoles) {
    if (ignored.has(role)) {
      issues.push({
        field: "requiredRoles",
        message: `Required role "${role}" is mapped as ignored.`,
      });
    }
  }
  for (const [productGid, override] of Object.entries(rules.productOverrides)) {
    if (override.maxGraphemes !== undefined && override.maxGraphemes !== null && override.maxGraphemes < 1) {
      issues.push({
        field: `productOverrides.${productGid}.maxGraphemes`,
        message: "Override grapheme limit must be at least 1.",
      });
    }
    const overrideIgnored = override.requiredRoles?.filter((r) => ignored.has(r)) ?? [];
    if (overrideIgnored.length) {
      issues.push({
        field: `productOverrides.${productGid}.requiredRoles`,
        message: `Override required roles conflict with ignored mapping: ${overrideIgnored.join(", ")}.`,
      });
    }
  }
  for (const [name, values] of Object.entries(rules.allowedOptions)) {
    if (values.length === 0) {
      issues.push({ field: `allowedOptions.${name}`, message: "Allowed set must not be empty." });
    }
  }
  if (rules.thresholds.winProb < 0 || rules.thresholds.winProb > 1) {
    issues.push({ field: "thresholds.winProb", message: "Winning probability threshold must be in [0, 1]." });
  }
  if (rules.thresholds.confidence < 0 || rules.thresholds.confidence > 1) {
    issues.push({ field: "thresholds.confidence", message: "Confidence threshold must be in [0, 1]." });
  }
  return issues;
}

export function resolveLinePolicy(rules: RuleSet, productGid: string) {
  const override = rules.productOverrides[productGid] ?? {};
  return {
    requiredRoles: override.requiredRoles ?? rules.requiredRoles,
    maxGraphemes: override.maxGraphemes === undefined ? rules.maxGraphemes : override.maxGraphemes,
    surfaces: override.surfaces === undefined ? rules.surfaces : override.surfaces,
    allowedOptions: override.allowedOptions ?? rules.allowedOptions,
    structuredAssignments: false,
  };
}

export function mappingForKey(entries: MappingEntry[], sourceKey: string): MappingEntry | undefined {
  return entries.find((e) => e.sourceKey === sourceKey);
}
