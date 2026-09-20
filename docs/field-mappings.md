# Supported field mappings

Merchants map Shopify source keys (line item custom attributes, selected options, order note) to roles:

| Role | Use |
| --- | --- |
| `personalization_content` | Engraving / name text used by DET01, DET02, SEM01 |
| `operational_request` | Line-level production instruction |
| `gift_message` | Gift context for SEM05; not used alone as a variant change (SEM02) |
| `selected_option` | Purchased option (finish, metal) |
| `ignored` | Stored, not evaluated |

Repeated keys are stored as ordered entries with `occurrenceIndex`. Source references look like `lineItems/{lineItemGid}/attributes/Engraving/0`.

P0 adapters:

- Shopify Order `note`
- LineItem `customAttributes { key, value }`
- Variant `selectedOptions { name, value }`

Third-party personalization apps are not verified in P0. Unmapped required sources yield **Unchecked**, not a missing-field finding.
