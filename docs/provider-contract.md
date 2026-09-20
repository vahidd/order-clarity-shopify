# Provider contract

`DecisionProvider` (`app/domain/types.ts`) returns typed choice classifications or a structured failure.

## Live: TypeSafe Jev

- `POST https://api.typesafe.ai/v1/systemone`
- Header: `Authorization: Bearer $TYPESAFE_API_KEY`
- Body: `{ model, state, questions }`
- Choice questions include full instructions and a criteria map
- Responses must include `model`, `answers[id].choice` in criteria, finite probabilities that sum to ~1, finite `confidence` in `[0,1]`
- Errors: 401 auth (not retried), 429 / 529 retryable, timeouts retryable
- Implementation: `app/integrations/jev/http.ts`
- Validation: `app/domain/providerValidate.ts`

Jev is a classifier only. The app does not ask it to generate corrected text or call tools.

## Demo / tests

`app/integrations/jev/fake.ts` is a deterministic classifier used only in demo and tests. Its outcomes are not Jev accuracy evidence.

## Thresholds (engineering defaults, stored with evaluation version)

High-confidence semantic issue: winning probability ≥ 0.90 and confidence ≥ 0.80 (`oc-eval-1.0.0`).
