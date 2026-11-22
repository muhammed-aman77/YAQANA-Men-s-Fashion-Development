# YAQANA Demo Catalogue Guide

## Demo environment

The demo catalogue is separate from the 24 existing `dev-dummy-*` records.

- Local database: `mongodb://127.0.0.1:27017/yaqana_local_dev_20261115`
- Demo marker: `isDemoData: true`
- Demo key prefix: `YAQANA-DEMO-`
- Demo stock: independent from legacy stock
- Legacy stock: 370 units remain on 24 existing product records

## Catalogue structure

The counts below describe the last read-only verified local snapshot; they are not a current database or hosted-preview assertion. No database was connected during the final release review.

The demo catalogue contains 18 fictional men's fashion products across:

- T-Shirts
- Shirts
- Hoodies
- Trousers
- Jeans
- Jackets

Each product has configured colours and sizes. Every colour-size combination is represented by one variant and SKU. The seed created 180 demo variants/SKUs.

Demo variants use:

- `YQ-DEMO-*` SKUs
- Fictional selling prices
- Fictional acquisition costs
- Independent physical stock
- Active, inactive, and discontinued lifecycle states
- Existing static demo image references with product/colour/variant fallback behavior

## Stock calculations

- On-hand: variant `stock`
- Reserved: variant `reservedQuantity`
- Available: on-hand minus reserved
- Committed: order quantity subset of reserved quantity
- Incoming: open inbound receipt balance
- Cost/retail value: demo-only paise values

Demo stock and legacy stock are never allocated or redistributed together.

## Seed

Dry run:

```powershell
cd yaqana-backend
npm run seed:local-demo-catalog -- --confirm-local-database=yaqana_local_dev_20261115
```

Apply:

```powershell
npm run seed:local-demo-catalog -- --apply --confirm-local-database=yaqana_local_dev_20261115
```

The seed:

- Requires the exact loopback database and development environment
- Uses insert-only operations
- Never overwrites manual edits
- Rejects product, collection, category, and SKU collisions
- Does not run automatically

The second apply run reported 18 products already present and 0 inserts.

## Reset

Dry run:

```powershell
cd yaqana-backend
npm run reset:local-demo-catalog -- --confirm-local-database=yaqana_local_dev_20261115 --confirm-reset=RESET-DEMO-CATALOGUE
```

Apply:

```powershell
npm run reset:local-demo-catalog -- --apply --confirm-local-database=yaqana_local_dev_20261115 --confirm-reset=RESET-DEMO-CATALOGUE
```

Reset removes only `isDemoData: true` records in the `YAQANA-DEMO-` namespace. It refuses to apply if carts, wishlists, orders, stock movements, or inbound receipts reference demo products.

## Storefront

- Demo product cards and detail pages show `DEMO CATALOGUE`.
- Selecting a colour filters the visible sizes for that colour.
- Inactive, discontinued, zero-stock and zero-available variants are disabled.
- Variant images take precedence over colour images and parent images.
- Add to Cart and Buy Now remain blocked for unavailable demo variants.
- The frontend and backend both enforce variant availability; frontend state is not authoritative.

## Admin

Local frontend: `http://127.0.0.1:5173`

Local backend: `http://127.0.0.1:5000`

Open `/admin`, sign in with an authorized local administrator account, and open Operations → Inventory. Demo rows show the `DEMO CATALOGUE` label.

Supported without transaction mutations:

- Search and filter inventory
- Group variants by colour and size
- View stock, reservation, availability, incoming and lifecycle values
- Export filtered inventory CSV
- Preview stocktake, receipt, unit-cost and CSV operations
- View stock movement history

Transaction-dependent actions remain blocked until the local MongoDB replica set is verified:

- Live stock adjustments
- Receipt application
- Reservation/checkout stock changes
- SKU restoration (the Restore control is visible but disabled until transactions are available)
- Refund and other stock/financial mutations
- Demo reset when references exist

## Hosted preview

Before hosted preview:

1. Create a separate preview-only database named `yaqana_demo_preview`.
2. Configure a separate Render preview service with its own demo-only database URI.
3. Use the preview Vercel origin in `FRONTEND_ORIGINS`.
4. Configure preview Cloudinary credentials or keep approved static demo images.
5. Seed only the preview database through an explicit confirmation command/API.
6. Do not seed production or `yaqana_staging`.

No hosted database, provider, credentials, or deployment has been configured or accessed.

## Release boundary — 2026-11-22

The local seed/reset commands are opt-in development utilities and were not executed during release preparation. They pin to the exact loopback development database and require explicit confirmation; do not use them against staging, production, or customer data. The reset also refuses to delete demo products referenced by supported records, including inventory approvals.

This guide does not establish that the local database contents are current or that a hosted preview exists. Checkout/reservation, receipt application, inventory mutation, COD settlement/reconciliation, shipment updates, returns and refunds remain deferred or transaction-gated as described in `YAQANA_TESTING_REPORT.md`. The last verified sample counts remain historical context only.
