# OrderClarity

Embedded Shopify app that checks personalized orders for incomplete, ambiguous, or conflicting instructions before production. Findings are an additional check. The interface uses **No issue detected** — never Safe, Guaranteed correct, or AI approved.

P0 MVP: onboarding, field mapping, versioned rules, deterministic + Jev semantic checks, review queue, observation/assisted-review tags, usage accounting, privacy redaction.

## Pinned versions

| Item | Pin | Why |
| --- | --- | --- |
| Shopify Admin GraphQL | `2026-07` | Latest stable as of 20 September 2026 (`2026-10` is a release candidate) |
| React Router app template | `7.18.2` | Current official Shopify embedded-app scaffold |
| `@shopify/shopify-app-react-router` | `^1.1.0` | Official React Router Shopify package |
| Prisma | `^6.16.3` | PostgreSQL ORM used by the official template |
| TypeSafe Jev | `POST https://api.typesafe.ai/v1/systemone` | Documented System One endpoint |
| Node | `>=20.19 <22 \|\| >=22.12` | Scaffold engine range |

## Local demo (no Shopify or TypeSafe credentials)

Requires Node 22.12+ (or 20.19+). PostgreSQL and Redis are **not** required for demo mode. Demo uses the shipped in-memory store, deterministic Jev fake, and demo Shopify adapter that cannot reach live Shopify.

```bash
npm install
APP_MODE=demo npm run demo
```

The process listens on `http://127.0.0.1:3000`.

- UI: http://127.0.0.1:3000/app
- Queue: http://127.0.0.1:3000/app/queue
- JSON overview: http://127.0.0.1:3000/api/overview
- JSON queue: http://127.0.0.1:3000/api/orders?tab=all
- Liveness: http://127.0.0.1:3000/healthz

The UI is labeled **Demo**. Operating mode defaults to **Observation**.

## Tests

```bash
npm test
```

This runs the P0 catalog T01–T34 against shipped evaluation, webhook, review, usage, tag-outbox, and redaction functions.

## Live mode

Live mode **fails startup** when required secrets are missing. It does not fall back to demo results.

```bash
cp .env.example .env
# fill SHOPIFY_API_KEY, SHOPIFY_API_SECRET, DATABASE_URL, TYPESAFE_API_KEY, ORDERCLARITY_ENCRYPTION_KEY
npm run setup          # prisma generate && prisma migrate deploy
APP_MODE=live npm run start
APP_MODE=live npm run worker
```

Shopify CLI (`shopify app dev`) is used after the owner creates a Partner app. See `docs/owner-setup-checklist.md`.

## Architecture

See `docs/architecture-decisions.md`. Domain logic has no Shopify/Jev I/O. Adapters: live Admin GraphQL + live Jev HTTP, plus demo/fake twins.

## Documentation

- `docs/architecture-decisions.md`
- `docs/data-model.md`
- `docs/field-mappings.md`
- `docs/provider-contract.md`
- `docs/prompt-versions.md`
- `docs/privacy-and-deletion.md`
- `docs/acceptance-tests.md`
- `docs/deployment-and-rollback.md`
- `docs/known-limitations.md`
- `docs/owner-setup-checklist.md`
- `docs/runbooks.md`
