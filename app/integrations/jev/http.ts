import { JEV_DEFAULT_MODEL, JEV_ENDPOINT, JEV_TIMEOUT_MS } from "../../domain/constants";
import type { DecisionProvider, ProviderInput, ProviderResult } from "../../domain/types";
import { validateChoiceAnswers } from "./validate";

export class JevHttpProvider implements DecisionProvider {
  readonly id = "jev" as const;

  constructor(
    private readonly opts: {
      apiKey: string;
      endpoint?: string;
      model?: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async classify(input: ProviderInput): Promise<ProviderResult> {
    const endpoint = this.opts.endpoint ?? JEV_ENDPOINT;
    const model = input.model || this.opts.model || JEV_DEFAULT_MODEL;
    const timeoutMs = input.timeoutMs || JEV_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const fetchImpl = this.opts.fetchImpl ?? fetch;
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          state: input.state,
          questions: input.questions,
        }),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;
      if (response.status === 401) {
        return { ok: false, error: "auth", retryable: false, detail: "TypeSafe authentication failed" };
      }
      if (response.status === 429) {
        return { ok: false, error: "rate_limit", retryable: true, detail: "TypeSafe 429" };
      }
      if (response.status === 529) {
        return { ok: false, error: "overload", retryable: true, detail: "TypeSafe 529" };
      }
      if (!response.ok) {
        return {
          ok: false,
          error: response.status >= 500 ? "network" : "validation",
          retryable: response.status >= 500,
          detail: `TypeSafe HTTP ${response.status}`,
        };
      }
      const json = await response.json();
      const validated = validateChoiceAnswers(input.questions, json);
      if (validated.ok) {
        return { ...validated, latencyMs };
      }
      return validated;
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return {
        ok: false,
        error: aborted ? "timeout" : "network",
        retryable: true,
        detail: aborted ? "TypeSafe timeout" : err instanceof Error ? err.message : "network error",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
