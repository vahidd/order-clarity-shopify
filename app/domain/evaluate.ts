import { validateChoiceAnswers } from "./providerValidate";
import {
  EVALUATION_VERSION,
  HIGH_CONFIDENCE_CONFIDENCE,
  HIGH_CONFIDENCE_WIN_PROB,
  MAX_RELEVANT_LINE_ITEMS,
  MAX_SERIALIZED_INPUT_CHARS,
  PROMPT_VERSION,
} from "./constants";
import {
  ambiguousAssignmentQuestion,
  itemState,
  personalizationConflictQuestion,
  textPurposeQuestion,
  unsupportedCustomizationQuestion,
  variantConflictQuestion,
} from "./prompts";
import { compareKey, graphemeCount, hasUnsupportedOperationalLanguage, isEmptyAfterTrim, stableJson } from "./text";
import type {
  CheckResult,
  DecisionProvider,
  EvaluationOutcome,
  FindingDraft,
  LineItemSnapshot,
  OrderSnapshot,
  ProviderResult,
  ReasonCode,
  RuleSet,
  Thresholds,
} from "./types";

function fingerprint(checkId: string, itemRef: string | null, reason: ReasonCode): string {
  return `${checkId}:${itemRef ?? "order"}:${reason}`;
}

function findingFromCheck(check: CheckResult, uncertain: boolean): FindingDraft {
  return {
    fingerprint: fingerprint(check.checkId, check.itemRef ?? null, check.reasonCode!),
    checkId: check.checkId,
    reasonCode: check.reasonCode!,
    itemRef: check.itemRef ?? null,
    sourceRefs: check.sourceRefs,
    evidence: check.evidence,
    method: check.method,
    uncertain,
    templateId: check.templateId,
    winningProbability: check.winningProbability,
    confidence: check.confidence,
  };
}

export function runDeterministicChecks(snapshot: OrderSnapshot): CheckResult[] {
  const results: CheckResult[] = [];
  for (const item of snapshot.items) {
    if (item.applicability === "removed") continue;

    if (item.applicability === "unmapped") {
      results.push({
        checkId: "DET05",
        outcome: "issue",
        reasonCode: "unchecked_unmapped",
        itemRef: item.lineItemGid,
        sourceRefs: [],
        evidence: { detail: "Required source is unmapped." },
        method: "deterministic",
        templateId: "det05_unmapped",
      });
      continue;
    }

    if (!snapshot.mappingComplete) {
      continue;
    }

    for (const role of item.policy.requiredRoles) {
      const mapped = item.mappedAttributes.filter(
        (a) => a.roleName === role && a.fieldRole === "personalization_content",
      );
      if (mapped.length === 0) {
        results.push({
          checkId: "DET05",
          outcome: "issue",
          reasonCode: "unchecked_unmapped",
          itemRef: item.lineItemGid,
          sourceRefs: [],
          evidence: { role, detail: "Required role has no mapped source." },
          method: "deterministic",
          templateId: "det05_unmapped",
        });
        continue;
      }
      const empty = mapped.every((a) => isEmptyAfterTrim(a.rawValue));
      if (empty) {
        results.push({
          checkId: "DET01",
          outcome: "issue",
          reasonCode: "missing_information",
          itemRef: item.lineItemGid,
          sourceRefs: mapped.map((a) => a.sourceRef),
          evidence: { role, sourceRef: mapped[0]?.sourceRef ?? "", original: mapped[0]?.rawValue ?? "" },
          method: "deterministic",
          templateId: "det01_missing",
        });
      }
    }

    if (item.policy.maxGraphemes != null) {
      for (const attr of item.mappedAttributes.filter((a) => a.fieldRole === "personalization_content")) {
        const count = graphemeCount(compareKey(attr.rawValue));
        if (count > item.policy.maxGraphemes) {
          results.push({
            checkId: "DET02",
            outcome: "issue",
            reasonCode: "length_exceeded",
            itemRef: item.lineItemGid,
            sourceRefs: [attr.sourceRef],
            evidence: {
              sourceRef: attr.sourceRef,
              count: String(count),
              limit: String(item.policy.maxGraphemes),
              original: attr.rawValue,
            },
            method: "deterministic",
            templateId: "det02_length",
          });
        }
      }
    }

    for (const [optionName, allowed] of Object.entries(item.policy.allowedOptions)) {
      const selected = item.selectedOptions[optionName];
      if (selected === undefined) continue;
      const allowedKeys = allowed.map(compareKey);
      if (!allowedKeys.includes(compareKey(selected))) {
        results.push({
          checkId: "DET03",
          outcome: "issue",
          reasonCode: "invalid_option",
          itemRef: item.lineItemGid,
          sourceRefs: [`lineItems/${item.lineItemGid}/selectedOptions/${optionName}`],
          evidence: {
            optionName,
            selected,
            allowed: allowed.join(", "),
            provenance: `rule:${snapshot.ruleVersion}`,
          },
          method: "deterministic",
          templateId: "det03_option",
        });
      }
    }

    if (item.policy.structuredAssignments) {
      const names = item.mappedAttributes.filter((a) => a.roleName === "assignment");
      const values = names.map((n) => compareKey(n.rawValue)).filter(Boolean);
      const unique = new Set(values);
      if (values.length < item.quantity) {
        results.push({
          checkId: "DET04",
          outcome: "issue",
          reasonCode: "structured_assignment",
          itemRef: item.lineItemGid,
          sourceRefs: names.map((n) => n.sourceRef),
          evidence: { detail: "Structured assignments are incomplete." },
          method: "deterministic",
          templateId: "det04_structured",
        });
      } else if (unique.size < values.length) {
        results.push({
          checkId: "DET04",
          outcome: "issue",
          reasonCode: "structured_assignment",
          itemRef: item.lineItemGid,
          sourceRefs: names.map((n) => n.sourceRef),
          evidence: { detail: "Structured assignments contain duplicates." },
          method: "deterministic",
          templateId: "det04_structured",
        });
      }
    }
  }
  return results;
}

function relevantItems(snapshot: OrderSnapshot): LineItemSnapshot[] {
  return snapshot.items.filter((i) => i.applicability === "applicable" || i.applicability === "unmapped");
}

function isHighConfidence(prob: number | undefined, conf: number | undefined, thresholds: Thresholds): boolean {
  return (prob ?? 0) >= thresholds.winProb && (conf ?? 0) >= thresholds.confidence;
}

function semanticFinding(
  checkId: string,
  reason: ReasonCode,
  itemRef: string | null,
  answer: { choice: string; probabilities: Record<string, number>; confidence: number },
  evidence: Record<string, string>,
  templateId: string,
  issueChoices: string[],
  thresholds: Thresholds,
): CheckResult {
  const winProb = answer.probabilities[answer.choice] ?? 0;
  const issue = issueChoices.includes(answer.choice);
  const uncertainChoice = answer.choice === "uncertain" || answer.choice === "unclear";
  const below = issue && !isHighConfidence(winProb, answer.confidence, thresholds);
  let outcome: CheckResult["outcome"] = "no_issue";
  if (uncertainChoice || below) outcome = "uncertain";
  else if (issue) outcome = "issue";
  return {
    checkId,
    outcome,
    reasonCode: issue || uncertainChoice || below ? reason : undefined,
    itemRef: itemRef ?? undefined,
    sourceRefs: evidence.sourceRef ? [evidence.sourceRef] : [],
    evidence,
    method: "semantic",
    templateId,
    winningProbability: winProb,
    confidence: answer.confidence,
  };
}

export async function evaluateOrder(args: {
  snapshot: OrderSnapshot;
  rules: RuleSet;
  provider: DecisionProvider;
  promptVersion?: string;
  evaluationVersion?: string;
  thresholds?: Thresholds;
}): Promise<EvaluationOutcome> {
  const thresholds = args.thresholds ??
    args.rules.thresholds ?? {
      winProb: HIGH_CONFIDENCE_WIN_PROB,
      confidence: HIGH_CONFIDENCE_CONFIDENCE,
    };
  const items = relevantItems(args.snapshot);
  const providerState = {
    schemaVersion: 1,
    orderRef: "opaque-order-reference",
    operationalNote: args.snapshot.originalNote,
    giftMessages: items.flatMap((i) =>
      i.mappedAttributes.filter((a) => a.fieldRole === "gift_message").map((a) => a.rawValue),
    ),
    items: items.map(itemState),
    merchantPolicy: {
      requiredRoles: args.rules.requiredRoles,
      surfaces: args.rules.surfaces,
      handleOrderNotes: args.rules.handleOrderNotes,
    },
  };
  const serialized = stableJson(providerState);
  const serializedInputChars = serialized.length;
  const relevantItemCount = items.length;

  if (args.snapshot.cancelled) {
    return {
      processingState: "excluded",
      overallLabel: "excluded",
      findings: [],
      checkResults: [],
      providerCalled: false,
      serializedInputChars,
      relevantItemCount,
    };
  }

  if (!args.snapshot.paginationComplete) {
    return unchecked("unchecked_pagination", serializedInputChars, relevantItemCount, false);
  }

  if (relevantItemCount > MAX_RELEVANT_LINE_ITEMS || serializedInputChars > MAX_SERIALIZED_INPUT_CHARS) {
    return unchecked("unchecked_limit", serializedInputChars, relevantItemCount, false);
  }

  const unmapped = items.some((i) => i.applicability === "unmapped") || !args.snapshot.mappingComplete;
  if (unmapped) {
    const det = runDeterministicChecks(args.snapshot);
    return {
      processingState: "complete",
      overallLabel: "unchecked",
      uncheckedReason: "unchecked_unmapped",
      findings: [],
      checkResults: det,
      providerCalled: false,
      serializedInputChars,
      relevantItemCount,
    };
  }

  if (hasUnsupportedOperationalLanguage(args.snapshot.originalNote)) {
    return unchecked("unchecked_language", serializedInputChars, relevantItemCount, false);
  }

  const det = runDeterministicChecks(args.snapshot);
  if (det.some((c) => c.reasonCode === "unchecked_unmapped")) {
    return {
      processingState: "complete",
      overallLabel: "unchecked",
      uncheckedReason: "unchecked_unmapped",
      findings: [],
      checkResults: det,
      providerCalled: false,
      serializedInputChars,
      relevantItemCount,
    };
  }
  const questions: Record<string, ReturnType<typeof personalizationConflictQuestion>> = {};
  const questionMeta: Record<string, { checkId: string; itemRef: string | null; reason: ReasonCode; templateId: string; issueChoices: string[] }> =
    {};

  for (const item of items) {
    const id = item.lineItemGid;
    questions[`pc:${id}`] = personalizationConflictQuestion();
    questionMeta[`pc:${id}`] = {
      checkId: "SEM01",
      itemRef: id,
      reason: "personalization_conflict",
      templateId: "sem01_conflict",
      issueChoices: ["conflict"],
    };
    questions[`vc:${id}`] = variantConflictQuestion();
    questionMeta[`vc:${id}`] = {
      checkId: "SEM02",
      itemRef: id,
      reason: "variant_conflict",
      templateId: "sem02_conflict",
      issueChoices: ["conflict"],
    };
    const hasPolicy = Array.isArray(item.policy.surfaces) && item.policy.surfaces.length > 0;
    questions[`uc:${id}`] = unsupportedCustomizationQuestion(hasPolicy);
    questionMeta[`uc:${id}`] = {
      checkId: "SEM03",
      itemRef: id,
      reason: "unsupported_request",
      templateId: hasPolicy ? "sem03_unsupported" : "sem03_uncertain",
      issueChoices: ["unsupported"],
    };
  }

  const needsAssignment =
    items.length > 1 || items.reduce((sum, i) => sum + i.quantity, 0) > 1;
  if (needsAssignment) {
    questions["assign"] = ambiguousAssignmentQuestion();
    questionMeta["assign"] = {
      checkId: "SEM04",
      itemRef: null,
      reason: "ambiguous_assignment",
      templateId: "sem04_ambiguous",
      issueChoices: ["ambiguous"],
    };
  }
  questions["purpose"] = textPurposeQuestion();
  questionMeta["purpose"] = {
    checkId: "SEM05",
    itemRef: null,
    reason: "gift_content",
    templateId: "sem05_mixed",
    issueChoices: ["mixed", "operational"],
  };

  let providerResult = await args.provider.classify({
    model: "jev-latest",
    state: providerState,
    questions,
    timeoutMs: 10_000,
  });
  if (providerResult.ok) {
    const validated = validateChoiceAnswers(questions, {
      model: providerResult.model,
      answers: providerResult.answers,
      usage: providerResult.usage,
    });
    if (!validated.ok) {
      providerResult = validated;
    }
  }

  return aggregate({
    det,
    providerResult,
    questionMeta,
    items,
    snapshot: args.snapshot,
    thresholds,
    serializedInputChars,
    relevantItemCount,
    promptVersion: args.promptVersion ?? PROMPT_VERSION,
    evaluationVersion: args.evaluationVersion ?? EVALUATION_VERSION,
  });
}

function unchecked(
  reason: ReasonCode,
  serializedInputChars: number,
  relevantItemCount: number,
  providerCalled: boolean,
): EvaluationOutcome {
  return {
    processingState: "complete",
    overallLabel: "unchecked",
    uncheckedReason: reason,
    findings: [],
    checkResults: [
      {
        checkId: "DET05",
        outcome: "issue",
        reasonCode: reason,
        sourceRefs: [],
        evidence: { detail: reason },
        method: "deterministic",
        templateId: "det05_limit",
      },
    ],
    providerCalled,
    serializedInputChars,
    relevantItemCount,
  };
}

function aggregate(args: {
  det: CheckResult[];
  providerResult: ProviderResult;
  questionMeta: Record<
    string,
    { checkId: string; itemRef: string | null; reason: ReasonCode; templateId: string; issueChoices: string[] }
  >;
  items: LineItemSnapshot[];
  snapshot: OrderSnapshot;
  thresholds: Thresholds;
  serializedInputChars: number;
  relevantItemCount: number;
  promptVersion: string;
  evaluationVersion: string;
}): EvaluationOutcome {
  if (!args.providerResult.ok) {
    return {
      processingState: "incomplete",
      overallLabel: "unchecked",
      uncheckedReason: "unchecked_provider",
      incompleteReason: args.providerResult.detail,
      findings: args.det
        .filter((c) => c.outcome === "issue" && c.reasonCode && c.reasonCode !== "unchecked_unmapped")
        .map((c) => findingFromCheck(c, false)),
      checkResults: args.det,
      providerCalled: true,
      serializedInputChars: args.serializedInputChars,
      relevantItemCount: args.relevantItemCount,
    };
  }

  const semantic: CheckResult[] = [];
  const answers = args.providerResult.answers;
  for (const [qid, meta] of Object.entries(args.questionMeta)) {
    const answer = answers[qid];
    if (!answer) {
      return {
        processingState: "incomplete",
        overallLabel: "incomplete",
        uncheckedReason: "incomplete_coverage",
        incompleteReason: `Missing provider answer for ${qid}`,
        findings: args.det.filter((c) => c.outcome === "issue" && c.reasonCode).map((c) => findingFromCheck(c, false)),
        checkResults: args.det,
        providerCalled: true,
        providerModel: args.providerResult.model,
        serializedInputChars: args.serializedInputChars,
        relevantItemCount: args.relevantItemCount,
      };
    }
    const item = args.items.find((i) => i.lineItemGid === meta.itemRef);
    const personalization = item?.mappedAttributes.find((a) => a.fieldRole === "personalization_content");
    const evidence: Record<string, string> = {
      original: personalization?.rawValue ?? "",
      request: args.snapshot.originalNote,
      selected: item ? Object.values(item.selectedOptions).join(", ") : "",
      optionName: item ? Object.keys(item.selectedOptions)[0] ?? "" : "",
      surfaces: item?.policy.surfaces?.join(", ") ?? "",
      sourceRef: personalization?.sourceRef ?? "",
    };
    if (meta.checkId === "SEM05") {
      const purpose = answer.choice;
      if (purpose === "mixed") {
        semantic.push(
          semanticFinding(
            "SEM05",
            "gift_content",
            null,
            answer,
            { request: args.snapshot.originalNote, purpose },
            "sem05_mixed",
            ["mixed"],
            args.thresholds,
          ),
        );
      } else {
        semantic.push({
          checkId: "SEM05",
          outcome: purpose === "unclear" ? "not_applicable" : "no_issue",
          reasonCode: purpose === "gift_content" ? "gift_content" : undefined,
          sourceRefs: [],
          evidence: { request: args.snapshot.originalNote, purpose },
          method: "semantic",
          templateId: "sem05_mixed",
          winningProbability: answer.probabilities[answer.choice],
          confidence: answer.confidence,
        });
      }
      continue;
    }
    if (meta.checkId === "SEM03" && (!item?.policy.surfaces || item.policy.surfaces.length === 0)) {
      if (answer.choice === "unsupported") {
        semantic.push({
          checkId: "SEM03",
          outcome: "uncertain",
          reasonCode: "unsupported_request",
          itemRef: meta.itemRef ?? undefined,
          sourceRefs: [],
          evidence,
          method: "semantic",
          templateId: "sem03_uncertain",
          winningProbability: answer.probabilities[answer.choice],
          confidence: answer.confidence,
        });
        continue;
      }
    }
    semantic.push(
      semanticFinding(
        meta.checkId,
        meta.reason,
        meta.itemRef,
        answer,
        evidence,
        meta.templateId,
        meta.issueChoices,
        args.thresholds,
      ),
    );
  }

  const checks = [...args.det, ...semantic];
  const findings: FindingDraft[] = [];

  for (const check of args.det) {
    if (check.outcome === "issue" && check.reasonCode && check.reasonCode !== "unchecked_unmapped") {
      findings.push(findingFromCheck(check, false));
    }
  }

  for (const check of semantic) {
    if (!check.reasonCode) continue;
    if (check.checkId === "SEM05" && check.outcome === "no_issue") continue;
    if (check.outcome === "issue") {
      findings.push(findingFromCheck(check, false));
    } else if (check.outcome === "uncertain") {
      findings.push(findingFromCheck(check, true));
    }
  }

  if (findings.length > 0) {
    return {
      processingState: "complete",
      overallLabel: "issues",
      findings,
      checkResults: checks,
      providerCalled: true,
      providerModel: args.providerResult.model,
      serializedInputChars: args.serializedInputChars,
      relevantItemCount: args.relevantItemCount,
    };
  }

  return {
    processingState: "complete",
    overallLabel: "no_issue_detected",
    findings: [],
    checkResults: checks,
    providerCalled: true,
    providerModel: args.providerResult.model,
    serializedInputChars: args.serializedInputChars,
    relevantItemCount: args.relevantItemCount,
  };
}

export function withProviderRetry<T extends ProviderResult>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; delaysMs?: number[] },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const delays = opts?.delaysMs ?? [0, 0, 0, 0, 0];
  return (async () => {
    let last: T | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      last = await fn();
      if (last.ok) return last;
      if (!last.retryable) return last;
      const delay = delays[attempt] ?? 0;
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    return last as T;
  })();
}
