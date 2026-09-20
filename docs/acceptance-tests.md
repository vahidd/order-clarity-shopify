# Acceptance tests

Automated catalog: `tests/p0-catalog.test.ts`. Run with `npm test`.

T01–T34 are implemented against shipped functions (`evaluateOrder`, `OrderClarityRuntime.handleWebhook`, `createHttpApp`, usage reservation, redaction). Semantic cases use `FakeDecisionProvider`, not live Jev.

Executed 20 September 2026: `npx vitest run --reporter=verbose` — 53 passed, including T01–T34. T35–T38 are absent (P1). Isolation/authz subset T17, T18, T24, T25, T26 passed on the same shipped request path. PrismaStore two-instance test: web `handleWebhook` + worker `drain` + web `queue`/`orderDetail`/`resolveFinding` with empty web RAM (`orders.size === 0`) and no `hydrate()`.

T35–T38 are P1 (fulfillment holds) and are not part of this release.

Live Shopify and live Jev contract tests are **Not run** without owner credentials. See `docs/owner-setup-checklist.md`.
