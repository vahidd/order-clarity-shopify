# Privacy and deletion

## Collection

Minimum order fields for the configured checks. No customer email, address, payment, or IP in evaluation state.

## Retention (proposed)

- Normalized snapshots and findings: 90 days from latest evaluation
- Provider debug payloads: off by default; max 7 days if enabled
- Operational logs: 30 days, opaque IDs only
- Encrypted backups: max 35 days; deletion ledger reapplied after restore

## Webhooks

Mandatory topics: `customers/data_request`, `customers/redact`, `shop/redact`, plus `app/uninstalled`.

Uninstall stops jobs and Shopify writes immediately. Customer redaction nulls snapshot payloads, provider copies, and personalization evidence. Shop redaction applies that to the tenant.

## Logging

Audit events store action, actor, entity IDs, and revision. They must not contain long customer notes or provider prompts.
