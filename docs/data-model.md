# Data model

PostgreSQL schema: `prisma/schema.prisma` and `prisma/migrations/20260920120000_init_orderclarity/migration.sql`.

| Entity | Constraint |
| --- | --- |
| Shop | Unique domain |
| Installation | Unique shop + generation |
| AppUser | Unique shop + verified staff |
| ProductMapping | Unique shop + scope + version |
| RuleSet | Unique shop + scope + version; one current active per scope |
| OrderRecord | Unique shop + order GID |
| OrderSnapshot | Unique order + revision |
| Evaluation | Current flag per order |
| Finding | Unique fingerprint within evaluation |
| ReviewEvent | Append-only |
| ActionOutbox | Unique action key |
| WebhookReceipt | Unique shop + generation + event ID |
| UsageLedger | Unique shop + cycle + order |
| Subscription | One current entitlement per shop |
| AuditEvent | Append-only; no customer text |

Snapshots and provider payloads are encrypted at rest (`app/domain/crypto.ts`). Audit metadata stores IDs only.
