# YAQANA Admin Platform Master Requirements

## Intent

Build a dependable, premium e-commerce administration platform for YAQANA Men's Fashion by extending the existing React/Vite admin route and Express/Mongoose backend. The existing customer storefront is protected and must remain unchanged.

## Permanent constraints

- Work only in the existing repository and current local development environment.
- Do not connect to production or remote databases, write to staging, deploy, push, or change branches.
- Preserve all existing local development records, including the 24 products, 6 categories, and 3 collections.
- Do not drop collections, reset data, run unverified seeds, or perform destructive migrations.
- Do not read, print, commit, or expose `.env` values, credentials, customer data, or secrets.
- Do not modify customer-facing pages, components, styles, navigation, cart, checkout, or storefront behavior. If a necessary change could affect them, stop for authorization.
- Preserve existing authentication, APIs, models, media, cart, checkout, order, and inventory behavior unless a focused change is required and tested.
- Reuse the current React, Vite, Express, Mongoose, and test conventions. Do not add dependencies without need.
- Use verified backend data, integer paise for money, server-side authorization, input validation, transactions where required, idempotency for sensitive operations, and audit records for sensitive actions.
- Do not add nonfunctional controls, fake data, unverified metrics, or critical TODO placeholders.
- Ask a focused business-rule question when a requirement cannot be implemented safely from the existing behavior.

## Level 1 foundation

- Establish a consistent, premium admin design system for typography, color, spacing, controls, tables, panels, dialogs, status badges, feedback, loading, empty, and error states.
- Provide compact, collapsible admin navigation and a useful page header with title, breadcrumbs, search, notifications, and profile access as those features become functional.
- Implement server-enforced staff roles and permissions, not just frontend hiding.
- Provide a real-data dashboard with revenue/order trends, recent orders, best sellers, low/out-of-stock alerts, activity, tasks, payment overview, status distribution, and date filters. Do not fabricate values.
- Approved dashboard reporting addendum (2026-11-16): compare Today/Last 7/30/90 days against corresponding like-for-like local-calendar periods, including today through the current local time and matching local-time cutoffs; default to Last 7 days. Use each admin's saved `Asia/Kolkata` or `Europe/London` preference (first-use default India), keep stored timestamps UTC, handle UK DST, and show “Updated through” in the selected zone. KPI comparisons use actual records; Revenue follows the existing paid-only rule and excludes cancelled orders, Sales means units sold, AOV uses qualifying paid orders, and Customers means new customer accounts. The selected KPI layout is current value first with a compact change indicator and prior value. This approved slice is implemented and verified in `docs/superpowers/plans/2026-11-16-yaqana-dashboard-comparison.md`; remaining Level 1 foundation requirements are still in progress.
- Provide a complete product list with search, filters, sorting, pagination, status, stock, category, collection, price, sale price, SKU, image, and update information.
- Keep product creation out of the permanently expanded list. Use a distinct editor with cancel, validation, unsaved-change protection, clear save/publish behavior, and success/error feedback.
- Manage product details, media, categories, collections, pricing, publishing, variants, size-colour SKU combinations, SKU stock, and per-colour galleries. Preserve existing image references and do not change the storefront to display colour galleries.
- Provide inventory summaries, available/reserved quantities where supported, safe adjustments, movement history, low-stock alerts, and idempotent, transaction-safe updates.
- Provide order search/filtering, order detail, validated state transitions, timeline, fulfilment, shipping, COD distinctions, and guarded sensitive actions.
- Add COD confirmation, collection, delivery, failure, cancellation, and reconciliation workflows without conflating COD with gateway payment status.
- Add return/exchange requests, review, inspection, refund tracking, and duplicate-refund protection. Never mark a refund complete without verified confirmation.

## Level 2 business management

- Supplier profiles and purchase orders, including partial receiving and duplicate-safe inventory receipt.
- Provider-independent courier configuration, shipments, tracking, exceptions, and shipment history.
- RTO tracking with received/inspected/approved gates before restocking.
- Customer CRM with order history and verified spending metrics.
- Backend-validated promotions and coupons with eligibility, limits, and expiry.
- Finance views based on verified transactions, including refunds and COD reconciliation.
- Transaction-recorded customer wallet credits/debits with idempotency.
- Customer-support tickets with assignment, conversation history, and private notes.
- Admin management for supported homepage/content records without changing the storefront.
- Useful, genuine-data analytics for sales, products, variants, categories, customers, returns, COD, and inventory.

## Premium operational features

- Permission-aware global search across supported entities.
- Recent activity sourced from actual audit records.
- A linked action centre for work requiring attention.
- Persisted saved filters.
- Confirmed, permission-checked bulk operations with affected-record counts.
- Private internal notes for supported records.
- Permission-scoped CSV exports that minimize customer personal information.
- Low-stock/reorder insights based only on available historical data.
- Product completeness checks before publishing.
- A small, documented set of accessible keyboard shortcuts.
- Non-spammy success, error, validation, and warning notifications.
- Safe dashboard-widget preferences.

## Security and backend quality

- Enforce authentication and authorization on every protected API.
- Protect financial changes, refunds, wallet adjustments, staff/permission changes, product deletion, and inventory changes.
- Add audit history for sensitive administrative actions.
- Validate all inputs and return consistent, safe API errors.
- Provide bounded pagination, search, filters, and appropriate indexes.
- Use MongoDB transactions for multi-record financial, stock, and order operations; fail clearly when transaction topology is unavailable.
- Never trust client-submitted prices, discounts, totals, or payment status.
- Preserve current API contracts where practical and document necessary compatibility changes.

## Quality and delivery

- Test product create/edit/draft/publish/media/variant/archive/search behavior.
- Test inventory adjustments, history, alerts, and oversell prevention.
- Test order transitions, cancellation/restocking, COD, and returns/refund idempotency.
- Test owner/admin/restricted-staff permissions and unauthorized requests.
- Run regression checks for authentication, product/catalogue, cart, checkout, orders, payments, and image references without altering the storefront.
- Verify admin layouts at 1920x1080, 1440x900, 1366x768, 1024x768, 768x1024, 430x932, 390x844, 375x812, and 320x700.
- Fix root causes of clipping, overlap, inaccessible controls, and unusable mobile forms.
- Maintain `YAQANA_IMPLEMENTATION_PROGRESS.md`, `YAQANA_TECHNICAL_DECISIONS.md`, `YAQANA_TESTING_REPORT.md`, and `YAQANA_KNOWN_ISSUES.md` at each meaningful stopping point.
- Final delivery includes implemented, tested admin/backend functionality, documentation, a test report, and explicit remaining issues. Do not claim unverified functionality.

## Required implementation order

0. Inspect the repository, document the audit and architecture, and verify the current state.
1. Foundation: admin layout, navigation, design system, permissions, dashboard, search, activity feed.
2. Product management.
3. Inventory.
4. Orders and COD.
5. Returns and finance.
6. Level 2 operations.
7. Premium operational features.
8. Security, responsiveness, performance, regression, bug fixing, and final verification.

Do not begin Level 2 work until the Level 1 foundation is verified. Do not advance past critical failures in an earlier phase.

## Current Level 1 reconciliation — 2026-11-21

The line-by-line current status, source/test evidence, remaining work and blockers are in [YAQANA_LEVEL1_RECONCILIATION_2026-11-21.md](YAQANA_LEVEL1_RECONCILIATION_2026-11-21.md). This dated checklist corrects stale audit findings and preserves historical notes.

The customer admin UI now supports server-side search, status filtering, pagination, and protected profile/address/recent-order details. Results and limits are in `YAQANA_TESTING_REPORT.md`. Level 1 remains **NOT READY FOR MANUAL GIT PUSH**: transaction support, Owner authorization/bootstrap, COD/refund lifecycle, global search/activity/notifications, saved filters and other requirements remain incomplete or gated. No database, hosted service, deployment or Git write occurred in this continuation.
