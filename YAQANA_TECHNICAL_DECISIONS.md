# YAQANA Technical Decisions and Existing Contracts

## Repository and stack

- Keep the existing React/Vite frontend and Express/Mongoose backend.
- The customer storefront is protected. Admin-only UI belongs under the existing `/admin` route and admin-specific styles; backend changes must preserve the storefront API adapter.
- Reuse current service/controller/model/middleware patterns. Add dependencies only when required.

## Data contracts observed

- Product money is stored as integer paise in `pricePaise` and `discountPricePaise`; serialization exposes legacy storefront catalogue-unit aliases. The existing conversion factor is 83.
- Product variants and their SKUs/stock are embedded in Product. Product colour galleries and the base image list are also embedded.
- Product `category` and `collectionName` are strings. Category and Collection documents are maintained separately; do not assume ObjectId relationships.
- Stock changes are represented by `StockMovement` documents with actor, reason, before/after values, and an idempotency key where applicable.
- Orders store integer-paise totals and payment/order status. Checkout is server-priced and transaction-protected; mock online payment remains pending.
- Product image uploads validate type, signature, and size, then use configured Cloudinary or local storage.

## Authentication and permissions

- Backend authorization supports `customer`, `support_agent`, `admin`, and `owner` roles. Protected Admin APIs use backend `requireAdmin` checks; support routes apply role and assignment scope. Frontend route guards are additional UX, not a security boundary.
- Cookie auth includes CSRF protection when enabled; bearer-token compatibility remains in use.
- The role model and backend role boundaries are implemented. Preserve existing customer/admin records and do not infer or assign an owner from an account name or email. Initial Owner bootstrap and ownership transfer remain unimplemented and require separate explicit approval.
- `support_agent` receives ticket-only permissions and narrowly scoped customer/order reads required by an assigned ticket. It must not reach general admin routes or change products, inventory, payments, refunds, user permissions, or ownership. Admins may grant/revoke this role; every change requires a reason and a backend audit record.
- Admins retain general admin access and may grant/revoke Support Agent permissions with an audit record. They must never designate or promote any account to Owner, initiate or authorize an ownership transfer, or execute a transfer on an Owner's behalf. Only the current Owner may initiate and authorize a subsequent transfer. Owner inherits general admin access and receives escalated support requests.
- Initial Owner establishment must use a one-time, verified, operator-controlled local bootstrap, separate from ordinary admin role changes and unavailable through the admin API. It must require explicit selection of an existing eligible account by immutable user ID, independent out-of-band authorization, and confirmation; it must refuse to run if an active Owner already exists. Record the bootstrap actor separately from the target. No Owner identity has been selected or assigned.

## Current continuation notes â€” 2026-11-21

- Admin global search advertises Ctrl+K / Command+K to focus search and Escape to close results. The shortcut does not grant access; the search endpoint remains behind the existing backend authentication/authorization middleware.
- The public customer login/registration and separate MFA-backed admin login are distinct. Public auth never promotes by email match; the controlled Owner bootstrap is not implemented as an ordinary admin mutation and no Owner account/credentials were created.
- A compromised pending TOTP setup was invalidated on the existing active Admin identity by removing only the pending encrypted secret and login challenge. A replacement secret must be generated and shown in the local enrollment UI; never place it in logs, source, reports, or terminal output.
- Do not change MongoDB topology until explicit operator approval. Real persistence and multi-document transaction verification remain blocked by standalone local MongoDB; do not infer real database validation from model-double or mocked browser tests.
- After bootstrap there must be exactly one active Owner. A subsequent transfer requires the current Owner's session, recent reauthentication, explicit confirmation, an active eligible target different from the current Owner, and an audit record. Promote the target and demote the outgoing Owner atomically. Enforce at most one active Owner with a database uniqueness constraint and at least one with transactional service invariants.
- No admin or ordinary account-management path may remove, delete, suspend, deactivate, or demote the last active Owner. Ownership may change only through a completed, current-Owner-authorized transfer that promotes the replacement in the same transaction. Bootstrap, Support Agent grants/revocations, and ownership transfers must atomically record actor, target, prior/new roles or permissions, timestamp, reason, and action. Revoke affected sessions in the same transaction so the next request cannot retain removed privileges. The existing auth middleware reloads the User on each request and checks `Session.revokedAt`, which supports this design.
- Keep audit events append-only through the application with no update/delete API and no TTL. This alone is not tamper-proof against a database operator; true immutability also requires a MongoDB principal restricted to append-only audit writes or an approved immutable storage mechanism.
- Owner inherits admin behavior, so implementation must replace scattered strict `role === 'admin'` checks with shared, tested permission helpers where appropriate. Preserve customer/admin behavior and reporting preferences. The existing admin-preferences validator and serializer currently permit only `admin`; owner compatibility must be added explicitly.
- Backward-compatible migration must preserve existing `customer` and `admin` roles unchanged, add only the new role values/indexes, and never auto-promote any account. Add migration tests for existing accounts, API access, role revocation, exactly-one-active-Owner invariants, last-Owner protection against removal/suspension/demotion, and failed/rolled-back ownership changes.
- Level 1 server-enforced roles, owner bootstrap, and audit controls are prerequisites. Do not begin the Level 2 customer-support implementation until the Level 1 foundation is verified.

## Customer Support architecture (approved scope; deferred by dependency order)

- Build on the existing `SupportTicket` model, support API, customer accounts, and orders; do not create duplicate customer or order records.
- Customers may create/list/read/reply only to their own tickets. Support agents may manage assigned support tickets and see only the customer/order data needed for those tickets. Enforce ownership and role checks in backend query filters and middleware, not only in the UI.
- New tickets require one of the approved issue categories: orders, delivery, cancellations, returns, exchanges, refunds, payments, products, or account issues. Keep category optional for pre-existing tickets until a safe compatibility migration is defined.
- Use a unique persisted ticket reference and public conversation entries. Private internal notes remain internal in serialization, filtering, search, attachments, and notifications. Customers may reopen `Resolved` tickets; `Closed` tickets remain final unless an explicit later rule changes this.
- Track first public staff response and resolution timestamps from server-side events. Assignment is independent of status; use the approved new statuses `Open`, `In Progress`, `Waiting for Customer`, `Resolved`, and `Closed`. Retain legacy `Assigned` records as readable compatibility data until a non-destructive migration is reviewed.
- Use the shared in-app notification system as a Level 1 dependency; support responses create customer notifications. Do not claim email/SMS delivery or add an external provider until credentials and provider behavior are explicitly configured. No general notification model exists today.
- Support attachments must use a private, authenticated storage path with authorization on every read. Do not place customer attachments under the current public `/uploads` static mount or reuse the admin-only product-upload endpoint unchanged. Validate image signatures, allowed types, count, size, and generated filenames. Local development must not call Cloudinary or another remote service.
- Support ticket changes use the ticket activity history. Role/ownership changes use the separate append-only admin audit ledger. Owner escalation is a backend operation and delivers an in-app notification to the single active owner.
- The current local MongoDB is standalone. Owner bootstrap/transfer and role/session/audit updates that require multiple documents must fail closed until transaction-capable topology is available; do not weaken the invariants to make them work on standalone MongoDB.

## Database and environments

- Local development entry point pins the loopback `yaqana_local_dev_20261115` database.
- Local development startup pins `FRONTEND_ORIGINS` to `http://localhost:3000` and `http://127.0.0.1:3000` to match the Vite dev server's supported loopback URLs. This override is local-only; hosted CORS origins remain external configuration.
- Hosted startup consumes `MONGODB_URI`; the repository does not establish which URI is currently configured in Render.
- Documentation recommends a separate `yaqana_staging` Atlas database and says hosted staging is not deployed or tested. This is a recommendation, not verified deployment state.
- Never connect to remote databases or modify local data as part of this implementation without explicit authorization. Do not alter deployment configuration or deploy.
- Transactions require a replica-set or sharded topology; code should fail explicitly when an operation requires transactions and the topology does not support them.
- The verified local MongoDB 9.0.4 service currently runs with loopback-only networking and standalone topology. Any local topology change must follow a verified database backup; do not weaken order transaction guarantees to accommodate standalone MongoDB.

## Admin implementation

- Existing admin routes and backend services are already used by the single large `AdminDashboardPage.jsx`; avoid broad rewrites and extract components only when a focused task needs the boundary.
- The admin sidebar groups existing sections into Catalogue, Sales, Operations, and Insights, with Dashboard standalone at the top and Settings standalone at the bottom to preserve the established order. Group expansion is independent; selecting a grouped section expands its group and closes the mobile drawer. Keep section IDs, service behavior, active-section semantics, and accessible `aria-expanded`/`aria-controls` relationships consistent.
- The admin header title and breadcrumb use the active section label; do not reintroduce a fixed dashboard title for every section.
- Keep generated catalogue export artifacts and existing worktree modifications untouched.

## Product editing and purchase actions

- The Products section uses a compact header-level Add Product action that opens the existing editor in a native modal dialog for both create and edit. Dirty forms confirm before dismissal; duplicate products remain draft copies with zero stock.
- The storefront's Add to Cart button is the existing shopping-bag operation, presented with cart terminology. Buy Now adds the chosen product, size, colour, and quantity to that same cart without opening the drawer, then navigates to `/checkout`; guests are redirected through the existing protected-route login flow.
- Keep transaction-backed order placement protected. This UI flow does not claim that checkout/order persistence works on the current standalone MongoDB topology.
- Purchase buttons use only the existing warm brown, cream, and charcoal palette. Hover and press states use subtle movement, color, and shadow transitions; reduced-motion preferences are respected. Do not recolor product cards or unrelated site-wide buttons.
- Product-list search icon spacing is explicitly set so the input text does not overlap it. Search and Add Product actions wrap on narrow screens; product cards use a lower minimum width to permit tablet columns.
- Product cards always expose Archive (disabled for already archived items) and show full product images with `object-fit: contain`. Permanent deletion is a distinct confirmed action for inactive zero-stock products; the backend independently rejects active/invalid-stock products and any order, stock-movement, cart, or wishlist reference. A `ProductDeletionAudit` record and product removal commit in one transaction. If the deployment is standalone MongoDB, the endpoint fails clearly rather than removing either record.

## Dashboard comparison design (approved, implemented, and verified)

- Use the saved per-admin `Asia/Kolkata` or `Europe/London` reporting zone, defaulting first-time admins to India time. Persist through the authenticated admin profile; do not expose this preference to customer accounts.
- Default the reporting period to Last 7 days; offer Today and Last 30/90 days as the other presets.
- Keep stored timestamps UTC. Calculate Today/7/30/90-day calendar windows and same-time cutoffs in the selected IANA zone; compare like-for-like local-date windows, with UK DST-aware behavior. Show the server report's `asOf` as â€œUpdated throughâ€ in the selected zone.
- KPI cards use current value first, percentage/direction indicator, and prior-period value. Orders retain the existing all-status count meaning; revenue uses paid orders and excludes cancelled orders; units sold sums qualifying paid, non-cancelled item quantities; AOV divides qualifying paid revenue by qualifying paid orders; Customers means new customer accounts.
- Partially and fully refunded payment states remain excluded under the existing paid-only revenue rule. No refund ledger exists, so do not estimate partial-refund net amounts.
- `GET /api/admin/stats` keeps the existing operational snapshot and six-month chart response while adding a validated `report` payload for the selected period/time zone. Report order and customer queries are bounded by their period windows; daily revenue buckets use the same paid/non-cancelled predicate as the KPI.
- Reporting uses integer paise through aggregation and comparison, converting only at the API boundary. Added `createdAt`-supporting indexes for order and customer report queries.
- The frontend refetches only the report when period or time zone changes, persists a zone change before applying it, and shares the same report KPI/chart presentation between Dashboard and Analytics.
- See the approved design `docs/superpowers/specs/2026-11-16-yaqana-dashboard-comparison-design.md`, completed plan `docs/superpowers/plans/2026-11-16-yaqana-dashboard-comparison.md`, and verification results in `YAQANA_TESTING_REPORT.md`.

## Consequential rules requiring owner input

- High-risk approval policy for refunds, wallet adjustments, inventory changes, and other sensitive actions. Owner bootstrap and Support Agent assignment/revocation follow the approved policy above.
- COD confirmation, courier reconciliation, and collection transitions.
- Return eligibility, inspection, partial return, refund and exchange policy.
- Inventory reservation/available-stock semantics and reorder lead times.
- Promotion stacking, customer restrictions, and financial definitions outside the approved dashboard comparison (including net partial-refund revenue without a refund ledger).

## SKU inventory continuation (2026-11-20)

- SKU quantities remain embedded in `Product.variants`; `StockMovement` remains the adjustment/receipt ledger. New `InventoryApproval` records preserve the requester/reviewer and approval state; new `InventoryInbound` records describe expected and received quantities without introducing Supplier or Purchase Order models.
- Adjustment policy defaults are 10 units for direct changes, 11â€“25 for explicitly confirmed changes, 26â€“50 for independent Admin approval, and above 50 for Owner approval. Thresholds come from the global `InventoryPolicy`, but no policy mutation API is enabled. Admins cannot decide Owner-level approvals; Owner approval remains unavailable until the separately approved controlled bootstrap is implemented and completed.
- Available stock is `onHand - reservedQuantity`. Adjustment validation and atomic update filters prevent an on-hand reduction below reserved units. Reservation lifecycle integration remains blocked; this does not establish order/reservation consistency.
- Receiving accepted quantities must update SKU/product stock, cost coverage, receipt event history, and exactly one `purchase_receipt` movement in the same MongoDB transaction. Damaged, rejected, and cancelled units are recorded but are not added to sellable stock. The receive service fails closed when topology is not transaction-capable.
- The latest local topology evidence is standalone. The available backup is dated 2026-11-16 and is not accepted as a current-state precondition for database writes; no fresh restore verification was available on 2026-11-20. Do not execute database-backed receipt, reservation, or approval integration tests until a current backup and transaction-capable topology are verified.
- The admin page supports adjustment confirmation, Admin approval/rejection, and inbound receipt creation/partial-receive entry. Receipt UI actions use retry keys and surface the transaction blocker. These mocked UI flows do not verify receipt persistence or stock consistency.

## Customer administration continuation â€” 2026-11-21

- Customer listing requests use server-side `search`, `status`, `page` and `limit`; search is bounded to 100 characters and the screen requests 10 rows per page. Only `role: 'customer'` documents are eligible.
- `GET /api/admin/customers/:id` is mounted inside the existing router guarded by `requireAuth` and `requireAdmin`. It matches both the requested ID and customer role, returns the basic contact/account fields and saved addresses, and limits recent orders to 10.
- Lifetime order count includes all customer orders; paid spend sums only orders with `paymentStatus: 'Paid'`. Backend arithmetic remains in integer paise and uses the existing conversion helper at the response boundary.
- The details UI is read-only and scoped to the selected customer. Tests use model doubles and mocked browser APIs; they do not prove real database authorization, data isolation, or persistence.

## Auth role-separation and coupon scope â€” 2026-11-21

- Public registration assigns `customer` server-side and ignores client role/permission input. Public login now accepts only customer accounts. Admin login must be a separate MFA-protected flow; until implemented, this change does not make administrator authentication operationally complete.
- Do not create the Owner identity or promote accounts without explicit operator approval. Owner bootstrap and transfer remain unavailable pending controlled procedures, MFA, and transaction-capable persistence.
- The current Master places coupons/promotions under Level 2 business management. A prior reconciliation called it Level 1; that attribution was incorrect. Do not implement coupon work during Level 1 continuation.
