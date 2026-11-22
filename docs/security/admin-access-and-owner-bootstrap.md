# YAQANA Administrative Access and Owner Bootstrap Runbook

## Administrator sign-in

- Customer sign-in remains `POST /api/auth/login`; it accepts active `customer` accounts only. Public registration always creates a customer.
- Staff sign in at `/admin/login` using `POST /api/admin-auth/login`, followed by `POST /api/admin-auth/verify`. Existing staff accounts must enroll a TOTP authenticator at first administrator sign-in.
- Existing role `support_agent` is the restricted Staff role. It receives the support-assignment permission only. `admin` and `owner` have their existing role boundaries; public input cannot assign any staff role.
- Every non-customer protected API requires a session issued after MFA. Existing pre-MFA staff sessions must reauthenticate. Staff/permission changes and revoking other sessions require recent password-plus-TOTP reauthentication.
- MFA secrets are encrypted using AES-256-GCM. Before enabling administrator sign-in, the operator must configure a stable `MFA_ENCRYPTION_KEY` containing a base64-encoded 32-byte key in the local/runtime secret store. Keep it stable across restarts and backups. Do not place its value in Git, logs, test output, or screenshots. The agent has not generated or installed this key.
- TOTP is replay-protected by storing the last accepted time counter. Recovery codes are random, stored only as password hashes, single-use, and displayed only after enrollment or deliberate rotation. Successful recovery-code sign-in revokes other active sessions. If the operator loses the encryption key or all recovery codes, do not bypass MFA; pause the account and perform a separately approved identity-proofed recovery.
- Password reset is not available because this repository has no verified email recovery provider or flow. The MFA recovery codes recover the second factor, not a forgotten password.

## Owner bootstrap — approval required

No Owner account has been created, selected, or promoted by this work. There is no Owner bootstrap API or command to run yet. `validateOwnerBootstrap` and `validateOwnerTransfer` are validation helpers only.

Prepare bootstrap only after all of these conditions are met:

1. The business owner identifies the person and existing account by immutable account ID; never select by an email-address rule.
2. The account is active, is already an eligible `admin` or restricted `support_agent`, and has verified TOTP MFA enabled.
3. The operator explicitly approves that account becoming the one designated Owner.
4. A fresh backup is restored and verified, and local transaction commit/rollback has passed on unique disposable fixtures after the separate MongoDB approval gate.
5. The database confirms there are zero Owner accounts. The unique `unique_owner_identity` partial index is actually present and valid, not merely declared in the Mongoose schema.
6. The operation runs atomically, writes an audit record identifying the approving operator and target account, preserves all other data, and verifies exactly one active Owner afterward.

Do not run an improvised update, seed, script, or role patch to bootstrap Owner. A reviewed, audited implementation and explicit approval are still required. Owner transfer must be a separate explicitly approved process with recent reauthentication, confirmation, a different eligible MFA-enabled target, transaction-backed role swap, audit record, and last-Owner protection.

## Current operator prerequisites

- Local MongoDB is recorded as standalone. Transaction-backed bootstrap is not available until the operator reviews and explicitly approves the separately documented MongoDB backup/configuration/rollback procedure.
- The current environment has no confirmed stable MFA encryption key. Administrator MFA login returns `MFA_CONFIGURATION_REQUIRED` until the operator provisions it.
- No production credentials or actual Owner identity were generated in this implementation.

## Local MFA key check — 2026-11-22

A local, non-disclosing check confirmed `MFA_ENCRYPTION_KEY` is present and decodes to the required 32-byte shape. The value was not printed or changed. This supersedes the earlier “no confirmed stable key” note for this worktree only. It does not prove the key is backed up or consistent across deployed instances, and no Admin login, authenticator enrollment, or real database persistence was performed in this verification.
