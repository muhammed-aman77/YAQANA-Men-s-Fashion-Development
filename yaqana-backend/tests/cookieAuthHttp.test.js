import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.NODE_ENV = 'test';
process.env.AUTH_COOKIE_ENABLED = 'true';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/yaqana_cookie_mock_test';
process.env.JWT_SECRET ||= 'cookie-auth-mock-test-secret-not-for-use-outside-this-test';
process.env.MFA_ENCRYPTION_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.FRONTEND_ORIGINS = 'http://localhost:3000';

const [{ app }, { default: User }, { default: Session }, { default: AdminAudit }, { hashPassword }, { encryptMfaSecret, createTotpCode }, cookieAuth] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/User.js'),
  import('../src/models/Session.js'),
  import('../src/models/AdminAudit.js'),
  import('../src/utils/password.js'),
  import('../src/utils/adminMfa.js'),
  import('../src/utils/cookieAuth.js')
]);

test('cookie login, CSRF bootstrap, authenticated requests, logout and revocation work over local HTTP with model doubles', async (t) => {
  const user = {
    _id: 'cookie-http-customer',
    name: 'Cookie Test Customer',
    email: 'cookie-http@example.test',
    passwordHash: await hashPassword('temporary-test-password'),
    role: 'customer',
    status: 'active'
  };
  let savedSession;
  t.mock.method(User, 'findOne', () => ({ select: async () => user }));
  t.mock.method(User, 'findById', async () => user);
  t.mock.method(Session, 'create', async (record) => {
    savedSession = { ...record, _id: 'cookie-http-session', revokedAt: null };
    return savedSession;
  });
  t.mock.method(Session, 'findOne', () => ({ select: async () => savedSession?.revokedAt ? null : savedSession }));
  t.mock.method(Session, 'updateOne', async (_query, update) => {
    savedSession.revokedAt = update.$set.revokedAt;
    return { modifiedCount: 1 };
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const origin = 'http://localhost:3000';

  const login = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'temporary-test-password' })
  });
  const loginBody = await login.json();
  const setCookies = login.headers.getSetCookie();
  const cookieHeader = setCookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
  const csrfToken = cookieAuth.getCookieValue(cookieHeader, cookieAuth.CSRF_COOKIE_NAME);

  assert.equal(login.status, 200);
  assert.equal(loginBody.authMode, 'cookie');
  assert.equal(Object.hasOwn(loginBody, 'token'), false);
  assert.ok(savedSession?.csrfTokenHash);
  assert.ok(setCookies.some((cookie) => cookie.startsWith(`${cookieAuth.SESSION_COOKIE_NAME}=`)));
  assert.ok(setCookies.some((cookie) => cookie.startsWith(`${cookieAuth.CSRF_COOKIE_NAME}=`)));
  assert.ok(csrfToken);
  assert.equal(login.headers.get('access-control-allow-origin'), origin);
  assert.equal(login.headers.get('access-control-allow-credentials'), 'true');

  const profile = await fetch(`${api}/auth/profile`, { headers: { Origin: origin, Cookie: cookieHeader } });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).user.email, user.email);

  const blockedLogout = await fetch(`${api}/auth/logout`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookieHeader, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(blockedLogout.status, 403);
  assert.equal((await blockedLogout.json()).code, 'CSRF_VALIDATION_FAILED');

  const logout = await fetch(`${api}/auth/logout`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookieHeader,
      'Content-Type': 'application/json',
      'X-YAQANA-CSRF-TOKEN': csrfToken
    },
    body: '{}'
  });
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.getSetCookie().some((cookie) => cookie.startsWith(`${cookieAuth.SESSION_COOKIE_NAME}=`) && /Expires=.*1970/i.test(cookie)));

  const revokedProfile = await fetch(`${api}/auth/profile`, { headers: { Origin: origin, Cookie: cookieHeader } });
  assert.equal(revokedProfile.status, 401);
  assert.equal((await revokedProfile.json()).code, 'SESSION_REVOKED');
  assert.ok(revokedProfile.headers.getSetCookie().some((cookie) => cookie.startsWith(`${cookieAuth.SESSION_COOKIE_NAME}=`) && /Expires=.*1970/i.test(cookie)));
});

test('Admin cookie session is created only after successful MFA over the separate Admin login route', async (t) => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const admin = {
    _id: 'cookie-http-admin',
    name: 'Cookie Test Admin',
    email: 'cookie-admin@example.test',
    passwordHash: await hashPassword('temporary-admin-test-password'),
    role: 'admin',
    status: 'active',
    mfaEnabled: true,
    mfaSecretEncrypted: encryptMfaSecret(secret, process.env.MFA_ENCRYPTION_KEY),
    mfaRecoveryCodeHashes: [],
    mfaLastCounter: -1,
    async save() {}
  };
  let sessionCreates = 0;
  let savedSession;
  t.mock.method(User, 'findOne', () => ({ select: async () => admin }));
  t.mock.method(User, 'findById', () => ({ select: async () => admin }));
  t.mock.method(User, 'findOneAndUpdate', async () => admin);
  t.mock.method(AdminAudit, 'create', async () => ({}));
  t.mock.method(Session, 'create', async (record) => {
    sessionCreates += 1;
    savedSession = { ...record, _id: 'cookie-http-admin-session', revokedAt: null };
    return savedSession;
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const origin = 'http://localhost:3000';
  const credentials = await fetch(`${api}/admin-auth/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: 'temporary-admin-test-password' })
  });
  const challenge = await credentials.json();
  assert.equal(credentials.status, 200);
  assert.equal(challenge.status, 'mfa_required');
  assert.equal(sessionCreates, 0);

  const login = await fetch(`${api}/admin-auth/verify`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken: challenge.challengeToken, code: createTotpCode(secret) })
  });
  const loginBody = await login.json();
  const setCookies = login.headers.getSetCookie();
  assert.equal(login.status, 200);
  assert.equal(loginBody.authMode, 'cookie');
  assert.equal(loginBody.user.adminMfaVerified, true);
  assert.equal(Object.hasOwn(loginBody, 'token'), false);
  assert.equal(sessionCreates, 1);
  assert.ok(savedSession?.mfaVerifiedAt instanceof Date);
  assert.ok(setCookies.some((cookie) => cookie.startsWith(`${cookieAuth.SESSION_COOKIE_NAME}=`)));
  assert.ok(setCookies.some((cookie) => cookie.startsWith(`${cookieAuth.CSRF_COOKIE_NAME}=`)));
});
