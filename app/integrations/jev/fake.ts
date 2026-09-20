import type {
  ChoiceAnswer,
  DecisionProvider,
  ProviderInput,
  ProviderResult,
} from "../../domain/types";
import { compareKey } from "../../domain/text";

export type FakeBehavior = "ok" | "timeout" | "overload" | "invalid_options" | "auth";

const METALS = [
  "gold",
  "silver",
  "rose gold",
  "rose-gold",
  "white gold",
  "yellow gold",
  "platinum",
  "brass",
  "copper",
  "bronze",
];

function dist(choice: string, criteria: Record<string, unknown>, confidence = 0.92): ChoiceAnswer {
  const keys = Object.keys(criteria);
  const probabilities: Record<string, number> = {};
  const rest = (1 - 0.94) / Math.max(1, keys.length - 1);
  for (const k of keys) probabilities[k] = k === choice ? 0.94 : rest;
  const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
  for (const k of keys) probabilities[k] = probabilities[k] / sum;
  return { type: "choice", choice, probabilities, confidence };
}

function lower(s: string): string {
  return compareKey(s).toLowerCase();
}

function extractNames(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-zA-ZÀ-öø-ÿ'’-]{1,30}\b/g) ?? [];
  const stop = new Set([
    "Please",
    "The",
    "Both",
    "Each",
    "Engrave",
    "Use",
    "Make",
    "Order",
    "Note",
    "Front",
    "Back",
    "And",
    "With",
    "This",
    "Ignore",
    "Rules",
    "Thanks",
    "Thank",
  ]);
  return matches.filter((m) => !stop.has(m));
}

function requestedMetal(text: string): string | null {
  const match = lower(text).match(
    /\b(?:make it|change (?:it )?to|use|want it in|not)\s+(rose gold|white gold|yellow gold|gold|silver|platinum|brass|copper|bronze)\b/i,
  );
  if (!match) return null;
  return match[1].toLowerCase();
}

function mentionsSurface(text: string, surface: string): boolean {
  const l = lower(text);
  return l.includes(surface) && (l.includes("engrav") || l.includes("add") || l.includes("also") || l.includes("please"));
}

type ItemState = {
  itemRef: string;
  quantity: number;
  selectedOptions: Record<string, string>;
  personalization: Array<{ sourceRef: string; fieldRole: string; value: string }>;
  policy: { surfaces: string[] | null };
};

type EvalState = {
  operationalNote?: string;
  giftMessages?: string[];
  items?: ItemState[];
};

export class FakeDecisionProvider implements DecisionProvider {
  readonly id = "fake" as const;
  behaviors: FakeBehavior[] = [];
  attempts = 0;
  classifyCalls = 0;
  onClassify: (() => Promise<void> | void) | null = null;

  constructor(behaviors: FakeBehavior[] = []) {
    this.behaviors = [...behaviors];
  }

  async classify(input: ProviderInput): Promise<ProviderResult> {
    this.attempts += 1;
    this.classifyCalls += 1;
    if (this.onClassify) await this.onClassify();
    const next = this.behaviors.shift() ?? "ok";
    if (next === "timeout") {
      return { ok: false, error: "timeout", retryable: true, detail: "fake timeout" };
    }
    if (next === "overload") {
      return { ok: false, error: "overload", retryable: true, detail: "fake 529" };
    }
    if (next === "auth") {
      return { ok: false, error: "auth", retryable: false, detail: "fake 401" };
    }
    if (next === "invalid_options") {
      return {
        ok: true,
        model: "fake-invalid",
        answers: Object.fromEntries(
          Object.keys(input.questions).map((k) => [
            k,
            {
              type: "choice" as const,
              choice: "not-a-real-option",
              probabilities: { "not-a-real-option": 1 },
              confidence: 0.9,
            },
          ]),
        ),
        usage: { input_tokens: 0, output_tokens: 0 },
        latencyMs: 1,
      };
    }

    const state = (input.state ?? {}) as EvalState;
    const note = state.operationalNote ?? "";
    const gifts = state.giftMessages ?? [];
    const items = state.items ?? [];
    const answers: Record<string, ChoiceAnswer> = {};

    for (const [qid, question] of Object.entries(input.questions)) {
      if (qid.startsWith("pc:")) {
        const item = items.find((i) => qid.endsWith(i.itemRef));
        const engraving = item?.personalization[0]?.value ?? "";
        answers[qid] = this.personalization(engraving, note, question.criteria);
      } else if (qid.startsWith("vc:")) {
        const item = items.find((i) => qid.endsWith(i.itemRef));
        answers[qid] = this.variant(item?.selectedOptions ?? {}, note, gifts, question.criteria);
      } else if (qid.startsWith("uc:")) {
        const item = items.find((i) => qid.endsWith(i.itemRef));
        answers[qid] = this.unsupported(item, note, question.criteria);
      } else if (qid === "assign") {
        answers[qid] = this.assignment(items, note, question.criteria);
      } else if (qid === "purpose") {
        answers[qid] = this.purpose(note, gifts, question.criteria);
      } else {
        const fallback = Object.keys(question.criteria).includes("consistent")
          ? "consistent"
          : Object.keys(question.criteria)[0];
        answers[qid] = dist(fallback, question.criteria);
      }
    }

    return {
      ok: true,
      model: "fake-deterministic",
      answers,
      usage: { input_tokens: 10, output_tokens: 4 },
      latencyMs: 1,
    };
  }

  private personalization(
    engraving: string,
    note: string,
    criteria: Record<string, string | null>,
  ): ChoiceAnswer {
    const e = compareKey(engraving);
    const n = compareKey(note);
    if (!e || !n) return dist("consistent", criteria);
    const ignoreAttempt = /ignore .{0,60}rules/i.test(note);
    if (/without the h/i.test(note) && e.toLowerCase().startsWith("sarah") && /sara/i.test(note)) {
      return dist("conflict", criteria);
    }
    const useMatch = note.match(
      /\b(?:use|change (?:the )?(?:engraving|name|text)?\s*to|change to|make it)\s+([A-Za-zÀ-öø-ÿ'’-]+)/i,
    );
    if (useMatch) {
      const requested = compareKey(useMatch[1]);
      if (requested && e && requested.toLowerCase() !== e.toLowerCase()) {
        if (!METALS.includes(requested.toLowerCase())) {
          return dist("conflict", criteria);
        }
      }
    }
    if (ignoreAttempt) {
      const change = note.match(/change (?:the )?(?:engraving|name|text)?\s*to\s+([A-Za-zÀ-öø-ÿ'’-]+)/i);
      if (change && compareKey(change[1]) !== e) return dist("conflict", criteria);
    }
    return dist("consistent", criteria);
  }

  private variant(
    selected: Record<string, string>,
    note: string,
    gifts: string[],
    criteria: Record<string, string | null>,
  ): ChoiceAnswer {
    const selectedVals = Object.values(selected).map(lower);
    const requested = requestedMetal(note);
    if (requested && selectedVals.length) {
      const selectedMetal = selectedVals.find((v) => METALS.some((m) => v.includes(m)));
      if (selectedMetal && !selectedMetal.includes(requested) && requested !== selectedMetal) {
        return dist("conflict", criteria);
      }
    }
    const giftText = gifts.join(" ");
    if (requestedMetal(giftText) && !requestedMetal(note)) {
      return dist("consistent", criteria);
    }
    return dist("consistent", criteria);
  }

  private unsupported(
    item: ItemState | undefined,
    note: string,
    criteria: Record<string, string | null>,
  ): ChoiceAnswer {
    const surfaces = item?.policy.surfaces;
    const wantsBack = mentionsSurface(note, "back") || /back engraving/i.test(note);
    const wantsInside = mentionsSurface(note, "inside");
    if ((wantsBack || wantsInside) && (!surfaces || surfaces.length === 0)) {
      return dist("uncertain", criteria, 0.7);
    }
    if (surfaces && surfaces.length > 0) {
      const allowed = surfaces.map(lower);
      if (wantsBack && !allowed.includes("back")) return dist("unsupported", criteria);
      if (wantsInside && !allowed.includes("inside")) return dist("unsupported", criteria);
    }
    return dist("consistent", criteria);
  }

  private assignment(
    items: ItemState[],
    note: string,
    criteria: Record<string, string | null>,
  ): ChoiceAnswer {
    const totalQty = items.reduce((s, i) => s + i.quantity, 0);
    const l = lower(note);
    if (/\bboth\b|\beach\b|\bsame name\b|\bidentical\b|\ball .*(with|engrav)/i.test(l)) {
      return dist("consistent", criteria);
    }
    const names = extractNames(note);
    if (totalQty >= 2 && names.length > totalQty) {
      return dist("ambiguous", criteria);
    }
    if (totalQty >= 2 && names.length >= 2 && names.length !== totalQty && !/both|each|same/i.test(l)) {
      return dist("uncertain", criteria, 0.65);
    }
    return dist("consistent", criteria);
  }

  private purpose(
    note: string,
    gifts: string[],
    criteria: Record<string, string | null>,
  ): ChoiceAnswer {
    const text = `${note} ${gifts.join(" ")}`;
    const l = lower(text);
    const operational =
      /please use|change to|make it|engrave|assign|without the h|ignore rules/.test(l);
    const gift =
      /happy birthday|congratulations|do not open|love you|best wishes|cannot wait|thanks/.test(l);
    if (operational && gift) return dist("mixed", criteria);
    if (operational) return dist("operational", criteria);
    if (gift || gifts.length > 0) return dist("gift_content", criteria);
    if (!compareKey(note)) return dist("unclear", criteria, 0.6);
    return dist("unclear", criteria, 0.55);
  }
}

export class InvalidOptionsProvider implements DecisionProvider {
  readonly id = "fake" as const;
  async classify(input: ProviderInput): Promise<ProviderResult> {
    return {
      ok: true,
      model: "fake-invalid",
      answers: Object.fromEntries(
        Object.keys(input.questions).map((k) => [
          k,
          {
            type: "choice" as const,
            choice: "nope",
            probabilities: { nope: 1 },
            confidence: 0.99,
          },
        ]),
      ),
      usage: { input_tokens: 1, output_tokens: 1 },
      latencyMs: 1,
    };
  }
}
