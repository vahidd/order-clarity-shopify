# Known limitations

- P1 fulfillment holds and P2 clarification links, extra languages, Flow connector, and production export adapters are out of scope.
- Demo persistence is in-memory; a process restart reseeds synthetic data.
- Live web and worker processes do not share RAM. Queue, overview, detail, and resolve read PostgreSQL through PrismaStore accessors; they do not hydrate a process-local snapshot.
- Live Admin GraphQL and Jev adapters exist but are unproven on a merchant store until the owner supplies credentials.
- Jev high-confidence thresholds are engineering defaults, not calibrated accuracy.
- P0 does not inspect uploaded images or print files.
- P0 English operational text only; non-English operational notes route to Unchecked.
- Tag writes are advisory and are not a manufacturing interlock.
- Embedded multiuser roles require a verified Shopify staff id; unidentified staff cannot mutate.
