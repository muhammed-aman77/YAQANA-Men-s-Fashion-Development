# YAQANA Known Issues and Open Decisions

## Verified implementation gaps

- Grouped admin navigation and a contextual header breadcrumb/title are implemented. Product permanent deletion now has a dedicated audit collection; there is still no general admin audit log, global command search, notification center, or activity feed.
- Dashboard period comparisons for Orders, Revenue, Units Sold, AOV, and New Customers are implemented for Today/7/30/90-day windows, with admin-specific India/London reporting zones and prior-period daily revenue. Best-seller metrics, payment distribution, and a task centre remain unimplemented.
- Product listing now has client-side search across names, categories, collections, and variant SKUs; category/collection/status/stock filters; sorting; visible SKUs; and 10-item pagination. Search operates on the product pages fetched by the admin screen.
- Permanent product deletion is guarded by archive status, zero/valid stock, order/inventory/cart/wishlist references, and a transactionally written deletion audit. The current standalone local MongoDB cannot execute the action; a replica-set or sharded topology is required.
- All current Support Centre dropdowns use the themed accessible selector. A native operating-system popup is no longer used for customer, order, priority, status, or assignee choices.
- The complete Customer Support scope remains Level 2 and deferred. Current authenticated ticket APIs provide limited ticket creation, assignment, replies, and role-scoped access; they do not provide the full Level 2 workflow, including issue categories, attachments, reference numbers, customer notifications, reopening, response/resolution timestamps, or owner escalation. The `customer`/`support_agent`/`admin`/`owner` role model and backend boundaries are implemented. No Owner identity was selected; controlled Owner bootstrap and ownership transfer remain unimplemented and require separate approval. Admins may grant/revoke Support Agent access only and cannot designate or promote Owners or initiate, authorize, or execute ownership transfers. The last Owner protections and transfer requirements remain future work.
- Product detail supports Add to Cart and Buy Now. Guest Buy Now correctly redirects to login before checkout; completing an order still depends on authentication and transaction-capable MongoDB.
- Orders now support server-side admin search (order ID/reference and customer name/email/phone), combined status/payment/COD/date filters, bounded pagination, and responsive loading/error/empty states. Controller HTTP tests use Mongoose model doubles and browser tests mock the API; no authenticated database-backed Orders request was performed. A dedicated detail/timeline view, fulfilment/shipment integration, and transaction-dependent status/cancellation verification remain outstanding.
- The backend has no staff-role/permission model, return/refund records, supplier/purchase-order, shipment/courier, wallet, coupon, or general finance transaction modules.
- COD is only a payment method in an order; no separate confirmation/collection/reconciliation lifecycle exists.
- There is no verified live payment gateway. Test UPI orders remain pending.
- Current metrics and customer lists have limited business detail and need bounded, privacy-conscious APIs before they are expanded.

## Business decisions required before related work

- The explicit eligible account and independently verified operator authorization for the one-time initial Owner bootstrap; ownership must never be inferred from a name or email.
- Which roles may approve refunds, wallet adjustments, inventory changes, staff changes, and other high-risk actions.
- Return/exchange eligibility windows, inspection requirements, partial returns, and refund completion evidence.
- COD verification and reconciliation states; courier provider and shipment status source.
- Whether/when reserved stock exists, how it affects available stock, and reorder lead-time definitions.
- Coupon combination/precedence rules and reporting date/time-zone definitions.

## Continuation status correction â€” 2026-11-21

The earlier bullets are historical snapshots; current implementation status is in the latest dated sections of `YAQANA_LEVEL1_RECONCILIATION_2026-11-21.md`, `YAQANA_IMPLEMENTATION_PROGRESS.md`, and `YAQANA_TESTING_REPORT.md`. The current worktree includes permission-protected global search, an Admin activity view, selected actionable notifications with server-backed per-Admin read state, saved-filter preferences, product completeness checks, expanded dashboard summaries and CSV export. These remain short of full verification: browser API responses are mocked, backend controller tests use model doubles, MongoDB persistence is unverified, and sensitive-operation audit coverage is not yet fully reviewed. Admin MFA/login, recovery and session controls are implemented; actual account/device enrollment and cookie/session database persistence are not verified. The full current source review and release decision remain outstanding; status is **NOT READY FOR MANUAL GIT PUSH**.

## External configuration unknown

The source README states the hosted Render/Vercel/Atlas staging setup has not been deployed or externally tested. Actual provider values, active service state, and connected database remain unknown. Do not infer them from the repository hostname or documentation examples.

## Demo catalogue status

- Local demo catalogue is isolated, seeded, and idempotent.
- 18 demo products and 180 complete colour-size SKUs exist only with `isDemoData: true` and `YAQANA-DEMO-` keys.
- The 24 legacy products and 370 legacy units were not modified or allocated.
- 23 demo SKUs are zero-stock, 5 inactive, and 6 discontinued.
- Live demo stock adjustments, receipt application and reset of referenced records remain transaction-gated.
- Hosted preview database, preview Render service, preview Vercel deployment and live Cloudinary provider setup remain manual external prerequisites.

## Dashboard comparison limitations

- Frontend dependency installation reported 5 advisories (3 moderate, 2 high). They were not investigated or remediated as part of this slice; package manifests and lockfiles were not changed.
- Local admin CORS is fixed and its preflight is verified through the Vite proxy. Actual account authentication remains unverified because no credentials were submitted.
- Local checkout and order placement still require transaction support. The `MongoDB` service is MongoDB 9.0.4, bound only to `127.0.0.1:27017`, with standalone topology. The current session is not an Administrator; the protected config is owned by SYSTEM, and the earlier attempt to edit it returned `EACCES`. A fresh full-database backup was created and successfully restored into an isolated database: all 12 collection counts and index definitions matched, including the 24-product catalogue. The older archive is stale because it omits the now-present empty `productdeletionaudits` collection. No config change or service restart occurred; changing the protected file and restarting the service require authorized Windows Administrator access. Do not bypass that restriction.
- The standalone-MongoDB transaction guard was verified locally and refused the operation before order or inventory mutation. Successful transaction commit/rollback behavior is still unverified until replica-set permission is resolved.

## SKU inventory continuation â€” 2026-11-20

- The local transaction gate remains unresolved. The latest topology evidence is standalone MongoDB (`setName: null`). On 2026-11-20, a fresh archive of the exact local database was restored to an isolated temporary database; all 12 collection counts and index definitions matched the source, including all 24 products. The older 2026-11-16 archive restores but is stale and lacks the currently present, empty `productdeletionaudits` collection. Temporary restore databases were removed; the fresh archive remains private outside Git. Do not run receipt-stock or reservation/order lifecycle writes or database-backed inventory consistency tests until transaction-capable topology and commit/rollback behavior are verified.
- Adjustment policy is active with defaults of 10 / 25 / 50 units. Medium adjustments require explicit confirmation; 26â€“50-unit adjustments require a different Admin; over-50-unit requests are saved as pending Owner-level approvals. No Owner identity/bootstrap exists, so Owner decisions are deliberately unavailable and Admins cannot decide these requests. Policy editing is not implemented.
- Admin approval flow is now connected to the inventory page, including self-approval prevention, rejection reason capture, and applied-request replay behavior. No live database approval was tested. The browser checks mock all API responses.
- Inbound receipt draft/list/receive endpoints and responsive admin create/partial-receive controls now exist. Receive mutations require transactions and return `503 TRANSACTIONS_REQUIRED` before mutation on the verified standalone topology. Browser tests use mocked responses. Transaction commit/rollback, concurrent receives, stock movement consistency, cost persistence, and receipt replay against MongoDB remain unverified.
- The full backend suite passed with all five database-gated cases skipped; this is not database-backed inventory verification. Mocked inventory, approval, and receipt UI tests now pass across 320â€“1920px Chromium viewports (desktop/tablet/mobile projects); they do not verify a live API or database or every physical browser/device.

## Cloudinary and Vercel deployment limits

- Source inspection confirms the server-side Cloudinary configuration, upload validation/security path, and Admin-authenticated deletion scoped to `yaqana/products/*`. Provider credentials, account state, external upload, and provider deletion were not tested; remote orphan cleanup remains unverified.
- Vercel and Render config files describe the expected rewrite/build/start/environment structure, but the live Vercel project root, connected branch, remote environment settings, Render service health, and active MongoDB target remain unknown. No hosted provider was contacted. The passing local frontend build does not verify deployment readiness.

## Local login and contact audit â€” 2026-11-21

- Root cause checked: the local backend can now start with `npm run start:local` even if no `.env` JWT secret is present. The launcher creates a process-only secret of at least 32 characters, while normal hosted startup still requires a configured secret. MongoDB remains pinned to `yaqana_local_dev_20261115`.
- Runtime verified locally: direct backend health and Vite proxy health returned 200; a deliberately invalid login returned 401. The backend also reported one active local admin account without displaying its identity or password.
- No WhatsApp integration or public WhatsApp number exists in source. The Contact form is intentionally nonfunctional and explains that messages are not sent or saved. No WhatsApp URL was guessed or added.
- Cloudinary upload validation and production environment checks pass in unit tests. Live account upload and deletion are unverified because provider credentials and remote access are intentionally not used.

## Preservation note

Existing product/category/collection data, customer storefront code, and pre-existing modified/untracked worktree files are out of scope for cleanup. Local database inspection was read-only; no database records, remote resources, deployment, or destructive operation has been changed.

## 2026-11-21 continuation blockers

- The fresh backup restored successfully, but the MongoDB service remains standalone and the current session is not elevated. Replica-set configuration, commit/rollback, reservation, receipt, cancellation, shipment stock integration and financial transaction tests remain blocked.
- Owner bootstrap is not implemented as an API. It requires explicit out-of-band operator authorization and an eligible existing immutable account ID. No Owner account was inferred or promoted.
- Refund completion, gateway refund confirmation, COD courier reconciliation, and exchange/restock rules still require explicit business/provider evidence. The API records requests and fails closed but is not a verified financial settlement system.
- Live Cloudinary account operations, WhatsApp business setup, Vercel, and Render remain external prerequisites.
- The approved loopback database currently contains 24 `dev-dummy-*` product records, not evidence of the actual staging catalogue. Every description labels the record a development sample and says the product attributes are illustrative. None has embedded variants or SKUs; 370 aggregate units remain unallocated. The staging catalogue and its actual SKU matrix are not verified.
- Unit-cost, stocktake, and CSV import mutation operations have preview/guard behavior but final stock writes require MongoDB transaction support and remain unavailable on standalone topology.

## SKU Restore continuation â€” 2026-11-21

- The admin inventory UI now offers Restore for inactive/discontinued SKU rows, but disables the action when the inventory API reports no MongoDB transaction support. The local database is standalone, so restoration cannot currently be performed there.
- When enabled on a transaction-capable database, the backend changes only the selected variant lifecycle and writes an `AdminAudit` record atomically. It does not alter stock, reserved quantity, cost, SKU, or product publication. The reason is required and bounded. Unit/service and mocked responsive tests pass; no transaction-capable persistence test was run.
- The approved local demo catalogue currently has 18 products and 180 unique SKUs: 169 active, 5 inactive, 6 discontinued, 0 duplicates. These counts are read-only observations, not proof of hosted demo readiness.
- Current full local verification: backend 190 passed, 0 failed, 5 database-gated tests skipped; frontend utilities 63 passed; mocked Playwright 96 passed; lint 0 errors/10 existing warnings; frontend build and backend syntax check passed. The skipped tests do not establish database transaction behavior.
- Remaining critical blockers are unchanged: standalone MongoDB prevents checkout/reservation, receipt application and other transaction-dependent mutations; successful commit/rollback and live SKU Restore audit persistence remain unverified. Hosted Vercel/Render/demo database and live Cloudinary operations are not configured or verified. **NOT READY FOR MANUAL GIT PUSH.**

## SKU and legacy-stock evidence reconciliation - 2026-11-21

This is a read-only report from the approved local database `yaqana_local_dev_20261115`. No product, image reference, SKU, or stock value was changed. Do not treat this local sample database as the staging catalogue: all 24 slugs begin with `dev-dummy-`, every description begins "Development sample only" and describes its product attributes as illustrative, and each record has one product-level `/images/dev-products/dev-dummy-*.jpg` reference. The stored size and colour labels below are recorded sample metadata, not verified sellable combinations.

| Product | Sizes recorded (unverified) | Colours recorded (unverified) | Original stock | Variants / SKUs | Allocated | Unallocated legacy |
|---|---|---|---:|---:|---:|---:|
| Brushed-Fleece Pullover | XS, S, M, L, XL, XXL | Mushroom, Cloud | 14 | 0 | 0 | 14 |
| Chambray Overshirt | XS, S, M, L, XL, XXL | Deep Chambray, Washed Blue | 11 | 0 | 0 | 11 |
| Charcoal Straight Jean | 30, 32, 34, 36, 38 | Charcoal, Washed Black | 15 | 0 | 0 | 15 |
| Compact Cotton Box Tee | XS, S, M, L, XL, XXL | Soft Mint, Chalk | 28 | 0 | 0 | 28 |
| Cotton-Twill Utility Jacket | XS, S, M, L, XL, XXL | Deep Teal, Olive | 7 | 0 | 0 | 7 |
| Denim Trucker Jacket | XS, S, M, L, XL, XXL | Vintage Blue, Indigo | 9 | 0 | 0 | 9 |
| Ecru Relaxed Jean | 30, 32, 34, 36, 38 | Ecru, Natural White | 10 | 0 | 0 | 10 |
| Essential Heavyweight Crewneck | XS, S, M, L, XL, XXL | Cloud White, Charcoal | 34 | 0 | 0 | 34 |
| French-Terry Relaxed Hoodie | XS, S, M, L, XL, XXL | Black, Ash Grey | 18 | 0 | 0 | 18 |
| Heavyweight Tonal Hoodie | XS, S, M, L, XL, XXL | Natural, Oat | 8 | 0 | 0 | 8 |
| Indigo Straight Jean | 30, 32, 34, 36, 38 | Dark Indigo, Rinse Blue | 24 | 0 | 0 | 24 |
| Lightweight Harrington Jacket | XS, S, M, L, XL, XXL | Black, Moss | 6 | 0 | 0 | 6 |
| Linen-Blend Drawstring Trouser | 30, 32, 34, 36, 38 | Ink, Natural | 18 | 0 | 0 | 18 |
| Linen-Blend Resort Shirt | XS, S, M, L, XL, XXL | Sand, Olive | 14 | 0 | 0 | 14 |
| Micro-Check Cotton Shirt | XS, S, M, L, XL, XXL | Teal Check, Ecru Check | 16 | 0 | 0 | 16 |
| Mid-Wash Tapered Jean | 30, 32, 34, 36, 38 | Mid Wash, Deep Blue | 20 | 0 | 0 | 20 |
| Oxford Button-Down | XS, S, M, L, XL, XXL | Blue Stripe, White | 17 | 0 | 0 | 17 |
| Quilted Liner Jacket | XS, S, M, L, XL, XXL | Ochre, Tobacco | 5 | 0 | 0 | 5 |
| Relaxed Pleated Trouser | 30, 32, 34, 36, 38 | Charcoal Check, Stone | 13 | 0 | 0 | 13 |
| Straight-Leg Tailored Trouser | 30, 32, 34, 36, 38 | Graphite, Midnight | 12 | 0 | 0 | 12 |
| Tapered Cotton Chino | 30, 32, 34, 36, 38 | Khaki, Navy | 21 | 0 | 0 | 21 |
| Textured Slub Tee | XS, S, M, L, XL, XXL | Washed Black, Warm Stone | 19 | 0 | 0 | 19 |
| Washed Jersey Tee | XS, S, M, L, XL, XXL | Dusty Rose, Faded Slate | 22 | 0 | 0 | 22 |
| Zip-Front Fleece Hoodie | XS, S, M, L, XL, XXL | Espresso, Stone | 9 | 0 | 0 | 9 |
| **Total** | - | - | **370** | **0** | **0** | **370** |

### Reconciliation and missing evidence

- For every row, `original stock = allocated SKU stock + unallocated legacy stock`; overall, `370 = 0 + 370`. The source documents still retain their original stock values.
- Actual SKU count: **0**. Duplicate SKU count: **0** (there are no SKU records to compare). Zero-stock SKU count: **0** (there are no variants). This is not evidence that a staging SKU catalogue has no duplicates.
- The sample labels do not establish which exact colour-size pairs exist. Do not generate the full Cartesian product, SKU codes, or per-SKU stock quantities from them. Product-level images are not variant-specific evidence.
- Before SKU creation, obtain the authoritative actual product-to-colour-to-size matrix, the verified physical on-hand count for every pair, and any existing SKU/barcode identifiers. For each product, the exact missing data is the verified colour-size combinations and their physical quantities.
- The inventory read model now reports legacy-only stock as `unallocatedLegacyUnits`; this keeps the legacy amount distinct in the dashboard and does not allocate or mutate it.
- The SKU editor validator requires a complete configured size-colour matrix, unique SKU/barcode values, zero stock for new variants, and protects existing stocked variants from ordinary product edits. The matrix cannot safely be populated from this illustrative dataset.

## Orders discovery continuation â€” 2026-11-21

- Read-only Orders search, combined filters, and server pagination are implemented. Search covers order ObjectId/visible reference suffix plus customer name, email, and phone; filters cover order status, payment status, COD/prepaid, and inclusive UTC dates. Invalid filter inputs fail with HTTP 400.
- The controller's in-process HTTP tests prove query construction and response behavior with Mongoose model doubles; they do not prove authenticated access or persistence against MongoDB. Full Playwright coverage uses mocked APIs.
- Order details/timeline, shipment/fulfilment, complete COD lifecycle, successful transaction-backed order/stock mutations, and live authenticated database verification remain incomplete or unverified. These gaps, together with the existing Level 1 role/Owner and MongoDB transaction blockers, mean the project remains **NOT READY FOR MANUAL GIT PUSH**.

## Customer management and regression recheck â€” 2026-11-21

- The supplied Orders hidden-row failure was not reproducible in the approved worktree. The original Orders suite passed 18/18 across desktop/tablet/mobile; the later full mocked suite also passed. Keep the timeline and fulfilment disclosure read-only.
- Customer admin UI now exposes the existing backend's role-safe search, status filters and pagination, with load/error/empty states. A protected details API and address/recent-order disclosure were added. Controller tests use model doubles and browser tests use mocked APIs; live database isolation and persistence remain unverified.
- Unified global search, notification centre, saved-filter persistence and general activity feed remain missing. Existing `AdminAudit` only records selected actions.
- Transaction-dependent inventory/order mutations remain gated by the standalone MongoDB prerequisite. Owner bootstrap, COD reconciliation, and refund/exchange rules require operator/business decisions.
- Coupon scope correction: the current `YAQANA_MASTER_IMPLEMENTATION.md` places promotions/coupons under Level 2, not Level 1. The earlier reconciliation incorrectly said Level 1. No coupon code exists; keep it outside this Level 1 continuation.
- Public registration hardcodes `customer`, and public login now rejects non-customer roles before session creation. A separate MFA-protected admin login, TOTP/recovery, MFA enforcement on existing sessions, session revocation/recovery flows, and Owner reauthentication remain unimplemented. See the dated continuation section in `YAQANA_LEVEL1_RECONCILIATION_2026-11-21.md`.
- Global search, notifications, saved-filter persistence, broad activity coverage, and product/dashboard/report completeness remain incomplete. Current overall status is **NOT READY FOR MANUAL GIT PUSH**.
- Current statuses and evidence: `YAQANA_LEVEL1_RECONCILIATION_2026-11-21.md`. Overall status: **NOT READY FOR MANUAL GIT PUSH**.

## Admin MFA replacement update â€” 2026-11-21

The latest implementation adds an authenticated Admin security page for replacing an enrolled authenticator. It requires the current password plus a current TOTP code or an unused recovery code, shows a local standards-compatible QR, and keeps the current factor active until the replacement code is accepted. Replacement setup fields are encrypted, session-bound, expire after five minutes, and are cleared on expiry by a local backend cleanup task. Backend/controller and cleanup tests use model doubles; the 159-case responsive browser suite mocks API responses while rendering the real local QR library. No actual Admin replacement, phone scan, or Google Authenticator code was verified. The user's local record remains active/admin/MFA enabled; the read-only check did not select secrets or write data. Lost phone plus no recovery code remains intentionally without a bypass or self-service reset. Owner-sensitive route coverage and full project readiness remain incomplete. See `YAQANA_MFA_IMPLEMENTATION.md` and the final continuation in `YAQANA_TESTING_REPORT.md`; overall status remains **NOT READY FOR MANUAL GIT PUSH**.

## Release freeze items â€” 2026-11-22

- **Responsive browser rerun:** one completed 162/162 mocked run passed before the support-only backend change. Later retries ended with 98 `page.goto` failures and 64 passes because Chromium could not load the local Vite server (`net::ERR_FAILED`). A final repeatable run is still required.
- **Database evidence:** five integration groups remain skipped; no real Mongo persistence or transaction proof. Transaction-dependent operations remain gated.
- **Audit behavior:** catalog, customer-status and Admin/staff support actions block on intent failure; completion failure leaves a durable intent and API error for reconciliation. This is not atomic.
- **Catalog cross-document edits:** category rename and collection rename/removal are disabled at the backend with `TRANSACTIONS_REQUIRED` before any write. They can be restored only after transaction-safe implementation and database verification.
- **Hosting:** no Cloudinary/Vercel/Render/staging test. Production needs valid MFA encryption key, transaction-capable Mongo, secure cookie auth, exact HTTPS origins and Cloudinary credentials; Vercel must keep browser API/upload calls same-origin through its proxy.
- **Worktree selection:** 287 paths at snapshot (69 modified tracked, 218 untracked, 0 deleted), including `.github`/`.vscode` guidance and historical plans. Preserve them, but do not stage those files unless intentionally included.
- **Quality advisories:** 9 lint warnings and 620.10 kB main bundle (>500 kB advisory).

These keep the release **NOT READY FOR MANUAL GIT PUSH**. COD settlement, returns/refunds, unspecified bulk actions, Owner bootstrap and transaction-dependent writes are deferred as documented; they remain in the Master.

## 2026-11-22 release-readiness continuation

- The earlier 96 `net::ERR_FAILED` navigation failures were traced to three route mocks (`admin-inventory`, `admin-orders`, `admin-product-list`) that accepted only `http://127.0.0.1:4173` and aborted traffic from the configured alternate `PLAYWRIGHT_PORT`. The test guards now derive their expected local origin from that port. No timeout was increased and no failures were suppressed.
- The Windows runner also exposed two harness issues: esbuild config bundling attempted an ancestor directory outside the permitted worktree, and Playwright’s managed server left a Node child alive after the server stopped listening. The build/test scripts now use Vite’s runner config loader; the E2E npm script starts Vite as a direct child, reuses it for the suite, and terminates it afterward. The focused E2E lifecycle check passed and port 4196 was released. A full 162-case suite is running at the time of this update.
- A demo reset safety gap was fixed: local demo reset now refuses deletion when an `InventoryApproval` references a demo product. Its focused model-double regression test verifies that deletion is not attempted. No reset script was executed and no local data was touched.
- Local MFA environment inspection checked only whether the key exists and matches the required 32-byte base64 shape; the value was not displayed. A suitable key is configured in this worktree’s local backend environment. This does not verify actual account enrollment or persisted MFA login. The backend `.env` has no `MONGODB_URI`; no database connection was attempted.
- The Admin Dashboard support section still has a minor entry-order issue: if Support is opened before Customers/Orders, customer and related-order options are not loaded. Admins can still create an internal ticket. Support tickets are Level 2 and this issue is recorded for that later stage.
- Historical statements above about absent search, notifications, saved-filter persistence, audit, MFA, and dashboard features are superseded by the dated reconciliation addenda. Current security/release findings must be read from the latest addenda, not the historical snapshot bullets.
- The complete source review is not certified. The current reviewer did not read every changed/untracked source, test, and document line by line; the 4,229-line dashboard and all test/documentation bodies are not all exhaustively covered. Overall remains **NOT READY FOR MANUAL GIT PUSH** until that review gap and any findings are resolved.
