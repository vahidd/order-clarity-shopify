# Deployment and rollback

## Deploy

1. Set `APP_MODE=live` and required secrets in the host environment.
2. Run `npm run setup` (`prisma generate && prisma migrate deploy`) as an explicit release step. Migrations are not applied on process boot.
3. Deploy web (`npm run start` / `react-router-serve`) and worker (`npm run worker`) from the same git SHA.
4. Confirm `/healthz` and webhook HMAC against a development store.

## Rollback

1. Redeploy the previous SHA for web and worker together.
2. Do not automatically run destructive down-migrations. Additive Prisma migrations are preferred.
3. If a migration must be reversed, restore the last encrypted backup and replay the deletion ledger.

## Backups

Daily encrypted PostgreSQL backups. Proposed recovery: 24 hours of data, four hours to restore pilot service — confirm with the chosen host before public launch.
