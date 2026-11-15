# YAQANA Backend

A new backend being built to serve the **existing YAQANA React/Vite storefront while preserving its current design**. The old backend remains read-only reference material and is not used as the new production codebase.

## Current implementation status

This is an actively developing backend, not yet a production-ready release.

### Implemented in this build

- Node/Express API foundation, environment validation, MongoDB connection, CORS allowlist, Helmet, rate limiting and central error handling.
- Liveness and database-readiness endpoints.
- Email/password registration and login using Node's scrypt password hashing.
- Bearer-token authentication compatible with the existing `sessionStorage` token flow, backed by revocable server-side session records.
- Profile read/update, password change and logout/session revocation.
- Product listing/detail, search/filter/sort/pagination and admin product create/update/archive.
- Product colour/size variants with unique SKUs, per-variant stock, and colour-specific image galleries.
- Admin SKU-level inventory, computed stock status, low-stock indicators, idempotent single-item adjustments, and movement history.
- Categories and collections, including admin management.
- Customer cart, guest-cart sync, wishlist and saved addresses.
- Checkout order creation with server-side product/price/stock lookup, MongoDB transaction, idempotency-key payload fingerprinting and order snapshots.
- Customer/admin order reads and guarded admin order-status transitions.
- Admin dashboard summary, customer listing/status controls.
- Admin image upload endpoint with local-disk development storage and Cloudinary-backed production storage.
- Bootstrap script for the first administrator account.

### Not yet complete / not approved for public launch

- Google sign-in, mobile OTP, email verification and password recovery.
- Admin MFA and granular staff/custom permissions.
- Expiring stock reservations. Checkout still supports legacy product-level stock and SKU variants, but requires MongoDB transactions.
- Live payment gateway, signed gateway webhooks, payment reconciliation and refunds. Current checkout is test/mock only and never marks UPI orders as paid.
- Final COD deposit and eligibility rules. The current UI has no deposit flow, so COD is recorded in compatibility mode only.
- Courier integrations, live PIN-code serviceability, shipment labels/tracking and RTO automation.
- Returns/exchanges, QC quarantine and refund workflows.
- Promotions, wallet/loyalty, reviews, support tickets, newsletter consent and notification workers.
- Cloudinary uploads are implemented but still require staging credentials and a hosted upload test. Local mode writes to ignored `uploads/` and is not durable hosting storage.
- Full audit-log coverage, backup/restore drill, security review, load/concurrency suite and end-to-end browser tests.

## Requirements

- Node.js 22 or newer.
- MongoDB Atlas or a local MongoDB replica set. Checkout uses MongoDB transactions; a standalone local MongoDB server is not sufficient for that route.
- Dependencies installed with `npm install`.

## Setup

Use the repository-root [README](../README.md) for the complete Windows instructions. In summary, install with `npm ci`, copy `.env.example` to `.env`, set a private random `JWT_SECRET`, and run `npm run dev`. The development script forcibly targets only `mongodb://127.0.0.1:27017/yaqana_local_dev_20261115`; a URI in `.env` cannot redirect it to a remote database. `npm start` uses the explicitly configured URI and is the hosted service command.

The local Vite frontend defaults to relative `/api` and proxies `/api` and `/uploads` to `http://localhost:5000`. Hosted staging keeps `/api` on the Vercel origin and rewrites it to Render so cookie authentication is not cross-site.

## Inventory and local MongoDB topology

The admin inventory API lists SKU variants as individual stock rows and falls back to aggregate product stock for legacy products without variants. Its report summarizes distinct products, stock records, units on hand, low-stock records, and out-of-stock records. Stock status is derived from the current quantity; the low-stock threshold is ten units, matching the dashboard summary and attention panel. Single-item adjustments use an idempotency key and a recoverable per-product lock, so they can be applied safely on the dedicated standalone local database and retried without double-counting. Product editing cannot bypass the inventory ledger by directly changing saved stock.

Bulk inventory adjustments, checkout, and order status/stock-restoration workflows require MongoDB replica-set or sharded transactions. The dedicated local database is standalone, so these requests return an explicit `503 TRANSACTIONS_REQUIRED` response without changing stock or orders. Do not bypass this guard or use a different database to work around it. Use a transaction-capable local MongoDB topology before testing those workflows.

The integration tests that write temporary fixtures are opt-in and hard-code the dedicated loopback database URI. Run them with:

```powershell
$env:RUN_LOCAL_DB_TESTS = '1'
npm test
```

They require an existing active local admin and remove only the temporary records created by each test.

## Development-only dummy catalogue

The approved 24-product development sample catalogue is stored in `data/dev-products.json`. Its products use `dev-dummy-` slugs, local photos, integer paise prices, and the three `DEV SAMPLE` collections. Image source pages, contributor credits, Pexels License references, retrieval dates, and SHA-256 hashes are recorded in `frontend/public/images/dev-products/manifest.json`.

For the dedicated local database `yaqana_local_dev_20261115`, use the separate fixed-target command below. It does not load `.env` or use an environment-provided MongoDB URI, and it refuses any host/database other than `127.0.0.1:27017/yaqana_local_dev_20261115`.

```powershell
$previousNodeEnv = $env:NODE_ENV
$previousMongoUri = $env:MONGODB_URI
try {
  $env:NODE_ENV = 'development'
  $env:MONGODB_URI = 'mongodb://127.0.0.1:27017/yaqana_local_dev_20261115'
  npm run seed:local-dummy-catalog -- --confirm-local-database=yaqana_local_dev_20261115
} finally {
  $env:NODE_ENV = $previousNodeEnv
  $env:MONGODB_URI = $previousMongoUri
}
```

The local command verifies all 24 image hashes and the four-per-category distribution before connecting. It inserts missing categories, collections, and products with `$setOnInsert`; it never updates or deletes existing records. An identity collision aborts before writes. Do not use the staging seed or cleanup commands for local database setup.

Do not use these commands against production. The seed command requires all of the following before connecting or writing:

- `NODE_ENV=development`.
- The connected MongoDB database name is exactly `test`.
- `DUMMY_CATALOG_SEED_ENABLED=true`.
- `DUMMY_CATALOG_EXPECTED_MONGODB_HOSTS` is a comma-separated local allowlist of every exact MongoDB seed host (hostnames and optional ports only; no credentials).
- The explicit `--confirm-staging-database=test` argument.

Set the allowlist only in the local backend `.env`, matching the seed hosts in its `MONGODB_URI`; do not commit actual staging hostnames or credentials. The command checks the URI target before connecting, checks the connected database and host set again before writes, and prints the database/topology identity without credentials or hostnames. A missing or mismatched safeguard aborts.

Preview the insert-only operation first:

```bash
npm run seed:dummy-catalog -- --confirm-staging-database=test --dry-run
```

Only after reviewing the verified target and preview, run the seed:

```bash
npm run seed:dummy-catalog -- --confirm-staging-database=test
```

Products, categories, and collections use `$setOnInsert`. Existing records are never overwritten; a name/slug identity collision aborts before any writes. Re-running the command is idempotent. Product prices are seeded as `INR * 100` paise; the storefront's legacy factor of 83 is not used for storage.

The cleanup command is read-only by default and selects only `dev-dummy-` products in the exact `DEV SAMPLE` collections. Review its output:

```bash
npm run remove:dummy-catalog -- --confirm-staging-database=test
```

Applying cleanup requires adding `--apply` and the same exact staging confirmation. Products referenced by a cart, wishlist, or historical order are archived; only unreferenced dummy products may be deleted. A `DEV SAMPLE` collection is removed only when no products use it. The cleanup command never removes categories or edits/deletes customers, carts, wishlists, or orders. Do not apply cleanup without a separate, deliberate review.

## Create the first administrator

For a developer's own local database, use the fixed-target interactive script:

```powershell
npm run create-admin:local -- --confirm-local-database=yaqana_local_dev_20261115
```

It connects only to the loopback local development database, prompts for a hidden password, and refuses to modify an existing account. Do not use the legacy `create-admin` or `resetAdminPassword` scripts for the existing owner account: they target the old `test` database rather than `yaqana_staging` and are not part of this setup. Use the guarded existing-account provisioning procedure below for staging. Admin MFA is still a required pre-production task.

## Compatibility notes

- Local development defaults to bearer JWTs in `sessionStorage` for existing storefront compatibility. An opt-in cookie mode is implemented for hosted staging: configure both `AUTH_COOKIE_ENABLED=true` and `VITE_AUTH_MODE=cookie`, and keep the API on the same Vercel origin through rewrites. Cookie sessions use host-only HttpOnly/Secure/SameSite=Lax session cookies and a session-bound double-submit CSRF token for writes. Direct cross-site browser calls to Render are not the supported cookie path.
- The current storefront's `formatInr()` converts legacy catalogue units using a factor of 83. The backend stores canonical amounts as integer paise and returns both `*Paise` fields and temporary legacy display fields (`price`, `subtotal`, `total`, etc.) so the unchanged frontend continues to render correctly.
- The frontend currently calculates shipping/tax using legacy values. Matching defaults are configurable in `.env` and are temporary compatibility settings, not approved final YAQANA commercial/tax policy.
- The checkout page explicitly describes UPI as mock/test only. The backend therefore records payment as `Pending` and does not claim that a payment was processed.

See `FRONTEND_COMPATIBILITY.md` for the audited endpoint contract and known conflicts.

## Hosted staging configuration

The root `render.yaml` prepares Render to run this folder with `npm ci`, `npm start`, and `/api/health/ready`; automatic Render deployment is disabled. The Vercel project should use `frontend` as its root, with `/api` and `/uploads` rewrites targeting Render before the SPA fallback. See the repository-root `README.md` for the complete Vercel, Render, Atlas, Cloudinary, cookie/CSRF, CORS, and manual environment-variable checklist.

The staging configuration has not been deployed or tested against external services. Render must receive a dedicated Atlas `yaqana_staging` replica-set URI, a random `JWT_SECRET`, exact HTTPS `FRONTEND_ORIGINS`, and all three Cloudinary credentials. Do not reuse the local or production database.

To provision the existing local administrator into the separate staging database, use the guarded interactive script documented in the root README's **Provision the existing administrator to staging** section. It verifies the current local password and copies the existing hash only after explicit Atlas host/database confirmation; it refuses staging account collisions and does not copy sessions. Do not execute it until the Atlas staging database is verified as separate from production.

## Security and operations

Never commit `.env`, provider credentials or customer data. Production startup requires Cloudinary storage, cookie authentication, HTTPS origins, and a replica-set or sharded MongoDB topology. Do not connect live gateway credentials until merchant onboarding, gateway selection, signed webhooks, idempotency and reconciliation have been reviewed and tested.
