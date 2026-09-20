# Owner setup checklist

Do not paste secrets into chat. Configure them in the environment.

1. Create a Shopify Partner app and development store.
2. Set scopes `read_orders,read_products,write_orders` (write only for Assisted review tags).
3. Confirm Admin API `2026-07` is acceptable for the app.
4. Subscribe to HTTPS webhooks in `shopify.app.toml` (orders, uninstall, subscription, privacy topics).
5. Provision PostgreSQL and Redis. Set `DATABASE_URL` and `REDIS_URL`.
6. Generate `ORDERCLARITY_ENCRYPTION_KEY` and `SESSION_SECRET`.
7. Obtain a TypeSafe API key. Confirm current commercial terms, DPA, and `POST /v1/systemone`.
8. Set `APP_MODE=live`. Missing secrets must fail startup.
9. Run `npm run setup`, install on the development store, place a mapped test order.
10. Calibrate Jev thresholds on merchant examples before enabling Assisted review.
11. Confirm billing (trial 14 days / 500 orders; Starter 1,000; Growth 5,000) in Shopify test mode.
12. Review protected customer data requirements and privacy topics before public distribution.
