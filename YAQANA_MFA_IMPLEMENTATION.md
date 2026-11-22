# YAQANA administrator MFA: implementation and usage

This guide reflects the source code in the approved development worktree. It does not mean the existing Admin has completed enrollment. Actual enrollment requires the Admin to scan the QR code in the local browser and submit a code from their own authenticator.

## What happens during enrollment

1. The Admin opens `/admin/login` and submits the existing staff email and password. The dedicated `POST /api/admin-auth/login` route accepts only active `support_agent`, `admin`, or `owner` records. Public `POST /api/auth/login` remains customer-only; public registration assigns only the customer role.
2. After the password check, the server creates a five-minute, purpose-bound, signed enrollment challenge and a new random 160-bit TOTP secret. It saves the pending secret encrypted and sends the challenge plus the `otpauth://` URI to the browser. The secret is not written to application logs.
3. The browser uses the local `qrcode` package to turn that URI into a PNG data URL. It does not call a QR-generation service. The enrollment panel appears only in this password-checked challenge flow. The local development frontend and backend are configured to bind to loopback (`127.0.0.1`).
4. The URI parameters are `issuer=YAQANA`, label `YAQANA Admin:<lowercase account email>`, `algorithm=SHA1`, `digits=6`, and `period=30`. The setup key in the optional manual-entry disclosure is the long-term secret; the six-digit phone code is temporary and changes about every 30 seconds.
5. The Admin submits the phone code to `POST /api/admin-auth/verify`. The server verifies it against the pending encrypted secret. One conditional user-record update enables MFA, activates the encrypted secret, removes the pending secret/challenge, and stores hashes of ten recovery codes. After that update, the server writes an audit event, creates an MFA-verified Admin session, and returns the plaintext recovery codes. These are sequential operations, not one end-to-end transaction. If audit storage fails after the user update, MFA is active and the recovery-code hashes are stored, but no session is created and the plaintext codes are not returned. If session creation or the response fails later, MFA remains active; the audit may already exist, while the session or recovery codes may not have reached the browser. Retry sign-in with the new authenticator. After signing in, rotate the recovery codes using the current password and a current TOTP code, then save the newly returned codes. Rotation itself updates the recovery-code hashes before writing its audit event and returning the plaintext codes; if it fails after the update, wait for a fresh TOTP code and retry rotation. Report a missing enrollment audit event only if it is absent.

## Later sign-ins

The Admin enters email and password at `/admin/login`. The backend checks the password, then returns a short-lived MFA challenge without making a session. The Admin enters the current six-digit code (or one unused recovery code). The backend checks challenge token signature and purpose, the database challenge identifier and expiry, account role/status, the authenticator code, and replay counter. It creates the session only after successful verification. There is no password-only fallback.

TOTP uses HMAC-SHA1 and accepts the current 30-second counter plus one counter on either side to allow up to roughly 30 seconds of clock drift. A code counter at or below the last accepted counter is rejected. Login verification is limited to 12 requests per IP per 15-minute window by the `/api/admin-auth` router's in-memory limiter. This limiter is process-local and needs a shared store before multi-process production use.

## Secret storage and session protection

The TOTP secret is encrypted with AES-256-GCM using a random 12-byte IV and an authentication tag. The key comes from `MFA_ENCRYPTION_KEY`, which must be stable, base64-encoded 32-byte key material. The stored record is versioned and includes the IV, tag, and ciphertext; user model fields containing MFA material are excluded from normal queries and JSON serialization. Recovery codes are random, stored as scrypt password hashes, and consumed one at a time.

Session records include `mfaVerifiedAt`, revocation state, and the recent-reauthentication timestamp. Admin middleware rejects administrative sessions without `mfaVerifiedAt`. Cookie mode uses an HttpOnly session cookie, SameSite=Lax, and CSRF token checks; production sets Secure and the production config requires cookie auth. In the local development server, HTTP means the cookie's Secure flag is false; do not treat this local setup as production transport security.

## Recovery and sensitive operations

Save the ten recovery codes shown once immediately after first enrollment. Each can be used once instead of a TOTP code. A recovery-code sign-in revokes the account's other active sessions. While still signed in, `POST /api/admin-auth/recovery-codes` rotates the set after checking the current password and a current TOTP code. It updates the hashes and accepted TOTP counter, then writes an audit event and returns the plaintext codes. This is sequential, not transactional: a failure after the update may leave new hashes active without delivering the codes. If that happens, wait for a fresh TOTP code and retry rotation; save the codes only after receiving the successful response.

`POST /api/admin-auth/reauthenticate` requires the current password and a fresh TOTP code and marks the session reauthenticated for five minutes. Staff permission/role mutations and revocation of other sessions require recent reauthentication. Revoke-other-sessions is available at `POST /api/admin-auth/sessions/revoke-others`.

There is no self-service authenticator reset or account recovery endpoint for an Admin who has lost both the phone and every recovery code. The recovery-code rotation endpoint cannot recover a completely lost factor. Any reset for that situation needs a separately reviewed, audited, operator-controlled recovery design; do not disable MFA or promote an account as a workaround. Owner bootstrap remains controlled and has not been run. The routes above do not prove that every sensitive Owner operation across the entire application has the intended recent-reauthentication or approval gate; comprehensive route-by-route audit remains outstanding.

## Use Google Authenticator

Use the official Google Authenticator app from the Play Store on Android or App Store on iPhone.

1. Open the YAQANA local Admin login page and sign in with the existing Admin email and password.
2. On the **Set Up Authenticator** screen, open Google Authenticator.
3. Tap **+** and choose **Scan a QR code**.
4. Scan the QR displayed on the YAQANA page.
5. Read the six-digit code Google Authenticator shows. Do not enter the long setup key as the code.
6. Enter the six digits in YAQANA and choose **Enable MFA and sign in**.
7. If verification succeeds, MFA becomes active, the Admin session is created, and YAQANA displays ten recovery codes once. Save those codes privately before continuing.

For later logins, enter the password, then the current six-digit phone code. If the QR scan fails, reveal the setup key only in the same local enrollment page and add it manually in Google Authenticator. Do not share or screenshot either the QR or setup key. Do not press **Start over** after scanning: a fresh password step issues a new pending enrollment challenge and secret.

## Replace an existing authenticator

An enrolled account does not show the first-time setup QR on its login page. To move from another authenticator app to Google Authenticator or replace a phone, sign in first, then open **Security & Authenticator** in the Admin navigation (or visit `/admin/security`). Enter the current password and either a current code from the existing authenticator or one unused recovery code. A recovery code is consumed when accepted.

YAQANA creates a separate, encrypted five-minute replacement setup. The existing authenticator stays active until a code from the new Google Authenticator entry is verified. The replacement challenge is bound to the current Admin session. After successful verification, one conditional user-record update swaps the active encrypted secret, replaces all recovery-code hashes with a fresh one-time set, and clears the pending setup. The server then revokes the account's other sessions, records a secret-free audit event, and returns the new plaintext recovery codes. These are sequential operations, not one end-to-end transaction. If session revocation or audit storage fails after the user update, the replacement factor and new recovery-code hashes are already active although the request may return an error; the new plaintext recovery codes may not reach the browser. The current session is excluded from revocation. Retry sign-in with the new authenticator. After signing in, if the recovery codes were not received, rotate them using the current password and a current TOTP code, then save the newly returned codes. Rotation can itself fail after changing the hashes; wait for a fresh TOTP code and retry. Report a missing replacement audit event or incomplete session revocation for reconciliation. A wrong code or abandoned setup does not turn off the old factor. Expired pending data is unset on verification or by a local backend cleanup task that runs at startup and every 30 seconds.

If the old authenticator and all recovery codes are unavailable, the replacement flow refuses to proceed. There is no automatic reset or password-only fallback; a separately approved controlled recovery procedure is required.

## Verification boundaries

Backend unit/controller tests use deterministic secrets, model doubles, and in-process handlers; they test URI parameters, TOTP acceptance/rejection/clock window/replay, encryption/tamper rejection, challenge expiry, recovery-code one-time use, login challenge/session behavior, replacement proof/replay/session binding/expiry/cleanup, and rate limiting. Playwright tests mock backend responses but execute the actual local QR rendering package and responsive page. The browser tests do not scan with Google Authenticator, and no real Admin credentials or phone code were used in automated testing. Local service health is not proof of Admin authentication. Do not mark replacement complete until the user scans the replacement QR and YAQANA accepts that live code.

The database-backed failure ordering, audit persistence, and session behavior for enrollment/replacement have not been integration-tested. Isolated staging verification must confirm the active factor, session revocation, audit record, and delivery of one-time recovery codes after success. Verify the documented recovery procedure for partial failures and reconcile missing audit or session-revocation work before treating these workflows as operationally verified.
