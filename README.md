# YAQANA

The repository contains a React/Vite storefront and admin frontend in `frontend/`, plus the Express/MongoDB API in `yaqana-backend/`. Run the two services in separate terminals. The supported local development entry point always uses a loopback MongoDB database; hosted staging uses a separate Atlas database and Cloudinary media.

## Required software

- Windows 10/11, Git, and Node.js 22 or newer (npm is included).
- MongoDB Community Server and MongoDB Shell (`mongosh`) for local development.
- Optional: MongoDB Compass for inspecting the local database.

## Clone and install

```powershell
git clone <repository-url>
Set-Location .\xora-main
Set-Location .\frontend
npm ci
Set-Location ..\yaqana-backend
npm ci
```

Install dependencies independently in both application folders. `frontend/package-lock.json` and `yaqana-backend/package-lock.json` pin their dependency trees.

## Local MongoDB setup

Every developer runs a separate MongoDB instance on their own computer. The local app and seed commands use only `127.0.0.1:27017/yaqana_local_dev_20261115`; no Atlas or shared database URI is used by `npm run dev`.

For the complete checkout/order workflow, run local MongoDB as a single-node replica set so transactions are available. On a new local installation, add this to the existing `mongod.cfg` while retaining its current `storage.dbPath` and loopback-only `net.bindIp`:

```yaml
replication:
  replSetName: rs0
```

Restart the MongoDB Windows service from an elevated PowerShell window, then initialize the replica set once:

```powershell
mongosh "mongodb://127.0.0.1:27017/admin"
rs.initiate()
rs.status()
```

Do not delete the MongoDB data directory. Back up an existing local database before changing service configuration. The backend can start against a standalone local server for catalogue, admin, support, and single-item inventory work, but checkout, order stock transitions, and bulk inventory intentionally return `503 TRANSACTIONS_REQUIRED` until MongoDB reports replica-set or sharded transaction support. Set `REQUIRE_MONGO_TRANSACTIONS=true` in the local `.env` to make the backend fail at startup instead of allowing that limited mode.

## Environment configuration

Create local, untracked environment files:

```powershell
Copy-Item .\frontend\.env.example .\frontend\.env
Copy-Item .\yaqana-backend\.env.example .\yaqana-backend\.env
```

In `yaqana-backend\.env`, replace `JWT_SECRET` with a random value of at least 32 characters. For example:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

The local Vite frontend defaults to `/api` and proxies `/api` and `/uploads` to `http://localhost:5000`. Keep `VITE_AUTH_MODE=bearer` locally unless deliberately testing the cookie-auth preview configuration. Never commit `.env` files, database files, secrets, or customer data.

## Seed the local sample catalogue

Run from `yaqana-backend` after MongoDB is ready:

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

The seed is repeatable and insert-only: it verifies the 24 source image hashes and the four-products-per-category distribution, then inserts only missing records. It preserves existing product edits and refuses identity collisions. It includes all six categories and three development collections. The product photos are tracked under `frontend/public/images/dev-products/`; their `/images/dev-products/...` URLs work from a fresh clone and do not depend on files on another developer's computer. The source and license references are in `frontend/public/images/dev-products/manifest.json`.

## Start the application

Use two PowerShell terminals:

```powershell
# Terminal 1
Set-Location .\yaqana-backend
npm run dev
```

```powershell
# Terminal 2
Set-Location .\frontend
npm run dev
```

Open `http://localhost:3000`. The API listens on port 5000; its liveness and database-readiness checks are `/api/health/live` and `/api/health/ready`.

## Local administrator and tests

Create a new local administrator without changing any existing account:

```powershell
Set-Location .\yaqana-backend
npm run create-admin:local -- --confirm-local-database=yaqana_local_dev_20261115
```

The script prompts for email, name, and a hidden password. It hard-binds to the local development database and refuses an existing email. Sign in at `http://localhost:3000/admin`.

Run checks from each folder:

```powershell
# frontend
node --test
npm run build

# backend
npm test
npm run check
```

MongoDB integration tests are opt-in and use only temporary fixtures in the exact local development database. From `yaqana-backend`, set `RUN_LOCAL_DB_TESTS=1`, `NODE_ENV=development`, and the exact loopback `MONGODB_URI` before running `npm test`. The cookie-auth/upload integration additionally requires `AUTH_COOKIE_ENABLED=true` and `MEDIA_STORAGE=local`. It removes only the user/session and uploaded file it creates.

## Hosted staging: Vercel, Render, Atlas, Cloudinary

The repository includes a Render blueprint at `render.yaml` and Vercel rewrites in `frontend/vercel.json`. These are deployment configuration only; this project has **not** been deployed or tested against hosted services. `autoDeploy` is disabled in the Render blueprint, and no deployment is performed by these instructions.

### MongoDB Atlas

Create a dedicated staging database named `yaqana_staging`, separate from every developer's local database and from any production/customer database. Use an Atlas replica-set or sharded deployment so MongoDB transactions are supported. Configure the Render service's `MONGODB_URI` with the staging-only URI, for example `mongodb+srv://<staging-user>:<staging-password>@<cluster-host>/yaqana_staging?retryWrites=true&w=majority`. Restrict Atlas network access to Render's documented static egress addresses or a private network connection; do not use a broad `0.0.0.0/0` rule as a shortcut.

### Cloudinary

Create or select a staging Cloudinary cloud and configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` as Render secrets. The Render blueprint sets `MEDIA_STORAGE=cloudinary`; production startup refuses local-disk media storage. New uploads return secure Cloudinary URLs. Existing seed images remain served as frontend `/images/...` static assets. Cloudinary credentials are not required for local development and must never be added to Git.

### Render backend

Use `yaqana-backend` as the service root. The blueprint runs `npm ci`, starts with `npm start`, checks `/api/health/ready`, and requires cookie authentication, Cloudinary, and MongoDB transaction support. Set these values manually in Render:

- `MONGODB_URI`: the Atlas `yaqana_staging` URI only.
- `JWT_SECRET`: a newly generated random secret of at least 32 characters.
- `FRONTEND_ORIGINS`: the exact HTTPS Vercel preview origin(s), comma-separated without trailing slashes.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: staging Cloudinary credentials.

The blueprint also sets `NODE_ENV=production`, `TRUST_PROXY=true`, `AUTH_COOKIE_ENABLED=true`, `REQUIRE_MONGO_TRANSACTIONS=true`, and `MEDIA_STORAGE=cloudinary`. Startup fails if required variables are missing or the connected MongoDB topology lacks transaction support.

### Provision the existing administrator to staging

Only run this after the dedicated Atlas `yaqana_staging` database exists and the Vercel Preview/Render configuration is approved. From `yaqana-backend`, set `ATLAS_STAGING_EXPECTED_HOST` in the current PowerShell session to the exact Atlas cluster hostname (for example `cluster0.example.mongodb.net`), then run:

```powershell
$env:ATLAS_STAGING_EXPECTED_HOST = "your-staging-cluster.mongodb.net"
npm run provision-admin:staging -- --confirm-staging-host=your-staging-cluster.mongodb.net --confirm-staging-database=yaqana_staging
```

The script reads only the fixed loopback local development database and connects only to the explicitly confirmed Atlas host and `yaqana_staging` database. It prompts for the existing email, hides the existing password and Atlas URI, verifies that password against the local hash, refuses an existing staging email, and copies the original password hash and admin identity without changing credentials or copying sessions. It creates no alternate account and never prints credentials or hashes. The Atlas URI is held only in process memory; do not put it in command history, `.env`, or Git. This is a manual operation and has not been run against Atlas.

### Vercel frontend and same-origin auth

Set the Vercel project root to `frontend`, framework to Vite, install command to `npm ci`, build command to `npm run build`, and output directory to `dist`. Set these variables for the intended Preview deployment:

- `VITE_API_BASE_URL=/api`
- `VITE_AUTH_MODE=cookie`

The `/api` and `/uploads` rewrites must remain ahead of the SPA fallback and target the Render service URL. Keep API calls on the Vercel origin; do **not** point `VITE_API_BASE_URL` directly at Render for cookie mode. The same-origin Vercel proxy is required because browsers may block cookies on direct cross-site Vercel-to-Render requests. Cookie sessions are host-only, HttpOnly, Secure in production, and SameSite=Lax. State-changing cookie-auth requests also require a session-bound CSRF cookie/header pair (`X-YAQANA-CSRF-TOKEN`). Render's `FRONTEND_ORIGINS` must allow the exact Vercel origin so credentialed CORS and preflight requests succeed. Update that allowlist when the preview origin changes.

Set Vercel variables and Render/Atlas/Cloudinary credentials manually. No credentials, staging database connection, Vercel/Render API access, or deployment is included in this repository setup. Do not push or deploy until explicitly approved.
