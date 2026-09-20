# Architecture decisions

## Scaffold

The official Shopify React Router template (forked from Remix, current as of 2026-09) is the embedded-app shell: `authenticate.admin`, App Bridge, Polaris web components, Prisma session storage.

OrderClarity domain code lives under `app/domain`, integrations under `app/integrations`, persistence under `app/store` and `prisma/`, HTTP under `app/http` and `app/routes`.

## Demo vs live is process configuration

`APP_MODE=demo|live` is required. Demo never talks to Shopify or TypeSafe. Live refuses to start without secrets and never silently uses the fake provider or demo Shopify adapter for merchant data.

## Persistence

PostgreSQL + Prisma is the live store (`PrismaStore` in `app/repositories/prisma.ts`). Live reads go through async store accessors (`getOrder`, `listOrders`, `listFindings`, `nextJob`, and the rest) that query Prisma after flushing writes. Web and worker processes do not hydrate a RAM snapshot on boot or on each request; RAM maps on `PrismaStore` are write-through caches only and are not the read API. Every persisted row includes `shopId`. Demo and automated catalog tests use the shipped `MemoryStore`, which implements the same accessors in RAM and enforces the same unique keys, tenant scoping, and compare-and-swap `rowVersion` rules. Redis/BullMQ is the intended live job backend; demo and tests use an in-process job table on `MemoryStore`.

Live boot (`createLiveRuntime`) constructs `ShopifyAdminAdapter` with shop-scoped Admin GraphQL (`unauthenticated.admin(shop.domain)` for workers; the current admin session is bound during embedded requests). After OAuth, `ensureTenantFromSession` creates the shop from `session.shop`. The Shopify account owner with a verified staff id may be recorded as Owner once; unidentified staff are never defaulted to Owner and cannot mutate.

## Evaluation

`evaluateOrder` is a pure function of snapshot + rules + `DecisionProvider`. Deterministic checks DET01–DET05 run in process. Semantic checks SEM01–SEM05 go through `DecisionProvider`. Aggregation never converts provider failure into no-issue.

## Shopify writes

Assisted review tags use `tagsAdd` / `tagsRemove` only. Desired state is written to an outbox in the same logical step as evaluation commit. App-managed tags are excluded from the content hash so tag webhooks cannot loop evaluations.

## Authorization

Shop identity is taken from the verified session, never from a client `shop_id`. Staff roles require a verified staff id recorded in `AppUser`. Missing identity is `unidentified`, not Owner.
