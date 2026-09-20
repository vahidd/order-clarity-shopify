import type { ChoiceAnswer, ChoiceQuestion, ProviderFailure, ProviderSuccess } from "./types";

const EPS = 1e-6;

function finite01(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

export function validateChoiceAnswers(
  questions: Record<string, ChoiceQuestion>,
  raw: unknown,
): ProviderSuccess | ProviderFailure {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "invalid_response", retryable: false, detail: "Response is not an object" };
  }
  const body = raw as Record<string, unknown>;
  const model = typeof body.model === "string" ? body.model : "";
  if (!model) {
    return { ok: false, error: "invalid_response", retryable: false, detail: "Missing model identifier" };
  }
  const answersRaw = body.answers;
  if (!answersRaw || typeof answersRaw !== "object") {
    return { ok: false, error: "invalid_response", retryable: false, detail: "Missing answers" };
  }
  const answers: Record<string, ChoiceAnswer> = {};
  for (const key of Object.keys(questions)) {
    const q = questions[key];
    const a = (answersRaw as Record<string, unknown>)[key];
    if (!a || typeof a !== "object") {
      return { ok: false, error: "invalid_response", retryable: false, detail: `Missing answer for ${key}` };
    }
    const rec = a as Record<string, unknown>;
    if (rec.type !== "choice" || typeof rec.choice !== "string") {
      return { ok: false, error: "invalid_response", retryable: false, detail: `Invalid choice payload for ${key}` };
    }
    const optionKeys = Object.keys(q.criteria);
    if (!optionKeys.includes(rec.choice)) {
      return {
        ok: false,
        error: "invalid_response",
        retryable: false,
        detail: `Choice ${rec.choice} is not in criteria for ${key}`,
      };
    }
    const probabilities = rec.probabilities;
    if (!probabilities || typeof probabilities !== "object") {
      return { ok: false, error: "invalid_response", retryable: false, detail: `Missing probabilities for ${key}` };
    }
    const probs: Record<string, number> = {};
    let sum = 0;
    for (const opt of optionKeys) {
      const p = (probabilities as Record<string, unknown>)[opt];
      if (!finite01(p)) {
        return {
          ok: false,
          error: "invalid_response",
          retryable: false,
          detail: `Non-finite probability for ${key}.${opt}`,
        };
      }
      probs[opt] = p;
      sum += p;
    }
    if (Math.abs(sum - 1) > 0.05) {
      return { ok: false, error: "invalid_response", retryable: false, detail: `Probabilities for ${key} do not sum to 1` };
    }
    if (!finite01(rec.confidence)) {
      return { ok: false, error: "invalid_response", retryable: false, detail: `Invalid confidence for ${key}` };
    }
    const winner = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (winner && winner !== rec.choice && Math.abs((probs[rec.choice] ?? 0) - (probs[winner] ?? 0)) > EPS) {
      return {
        ok: false,
        error: "invalid_response",
        retryable: false,
        detail: `Choice ${rec.choice} is not the winning option for ${key}`,
      };
    }
    answers[key] = {
      type: "choice",
      choice: rec.choice,
      probabilities: probs,
      confidence: rec.confidence,
    };
  }
  const usageRaw = (body.usage ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    model,
    answers,
    usage: {
      input_tokens: typeof usageRaw.input_tokens === "number" ? usageRaw.input_tokens : 0,
      output_tokens: typeof usageRaw.output_tokens === "number" ? usageRaw.output_tokens : 0,
    },
    latencyMs: 0,
  };
}
