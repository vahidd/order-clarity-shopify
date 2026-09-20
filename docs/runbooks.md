# Operator runbooks

Alerts go only to destinations the owner configures. Never email addresses extracted from orders.

## Provider outage

Detection: Jev 429/529/timeout rate. Containment: circuit stays closed after retries; orders become Unchecked — provider failure. Recovery: restore TypeSafe, recheck from the queue. Customer message: checks paused; existing reviews usable.

## Shopify authorization loss

Detection: 401 from Admin API. Containment: shop status `reconnect_required`, new scans pause. Recovery: merchant reconnects OAuth.

## Stale queue

Detection: oldest live job > 5 minutes. Recovery: worker lease expiry requeues; run reconcile.

## Migration failure

Do not boot over a failed migrate. Restore backup; fix forward.

## Billing outage

Record 7-day grace from last known entitlement, then pause new scans. Reviews stay available.

## Accidental tag behavior

Turn mode back to Observation (stops new writes). Optional cleanup removes only `orderclarity:*` tags.

## Privacy deletion failure

Retry redaction jobs; keep a deletion ledger; reapply after backup restore.
