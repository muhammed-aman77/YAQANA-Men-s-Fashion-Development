import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { uploadDirectory } from '../src/routes/uploadRoutes.js';
import Session from '../src/models/Session.js';
import User from '../src/models/User.js';
import { getCookieValue, CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '../src/utils/cookieAuth.js';
import { hashPassword } from '../src/utils/password.js';
import { createTotpCode } from '../src/utils/adminMfa.js';

const enabled = process.env.RUN_LOCAL_DB_TESTS === '1' &&
  process.env.AUTH_COOKIE_ENABLED === 'true' &&
  process.env.MEDIA_STORAGE === 'local' &&
  Boolean(process.env.MFA_ENCRYPTION_KEY) &&
  process.env.MONGODB_URI === 'mongodb://127.0.0.1:27017/yaqana_local_dev_20261115';

test('cookie login, CSRF protection, admin upload, and logout persist against the local API', {
  skip: enabled ? false : 'requires explicit local database opt-in, cookie auth, local media, and a stable MFA_ENCRYPTION_KEY'
}, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `cookie-flow-${suffix}@example.test`;
  const password = 'Temporary-Local-Test-Password-57!';
  let user;
  let server;
  let uploadedPath;

  try {
    await connectDatabase();
    user = await User.create({
      name: 'Temporary Cookie Test Admin',
      email,
      passwordHash: await hashPassword(password),
      role: 'admin',
      status: 'active'
    });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = 'http://localhost:3000';
    const api = `http://127.0.0.1:${server.address().port}/api`;
    const loginChallenge = await fetch(`${api}/admin-auth/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const challengeBody = await loginChallenge.json();
    assert.equal(loginChallenge.status, 200);
    assert.equal(challengeBody.status, 'mfa_setup_required');
    const login = await fetch(`${api}/admin-auth/verify`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken: challengeBody.challengeToken, code: createTotpCode(challengeBody.secret) })
    });
    const loginBody = await login.json();
    const cookiePairs = login.headers.getSetCookie().map((cookie) => cookie.split(';', 1)[0]);
    const cookieHeader = cookiePairs.join('; ');
    const sessionCookie = cookiePairs.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
    const csrfCookie = cookiePairs.find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`));
    const csrfToken = getCookieValue(cookieHeader, CSRF_COOKIE_NAME);

    assert.equal(login.status, 200);
    assert.equal(loginBody.authMode, 'cookie');
    assert.equal(loginBody.user.adminMfaVerified, true);
    assert.equal(loginBody.recoveryCodes.length, 10);
    assert.equal(Object.hasOwn(loginBody, 'token'), false);
    assert.ok(sessionCookie);
    assert.ok(csrfCookie);
    assert.equal(login.headers.get('access-control-allow-origin'), origin);
    assert.equal(login.headers.get('access-control-allow-credentials'), 'true');

    const profile = await fetch(`${api}/auth/profile`, {
      headers: { Origin: origin, Cookie: cookieHeader }
    });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).user.email, email);

    const blockedLogout = await fetch(`${api}/auth/logout`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookieHeader, 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(blockedLogout.status, 403);
    assert.equal((await blockedLogout.json()).code, 'CSRF_VALIDATION_FAILED');

    const imagePath = fileURLToPath(new URL('../../frontend/public/images/dev-products/dev-dummy-essential-heavyweight-crewneck.jpg', import.meta.url));
    const imageBytes = await readFile(imagePath);
    const form = new FormData();
    form.append('image', new Blob([imageBytes], { type: 'image/jpeg' }), 'local-test.jpg');
    const upload = await fetch(`${api}/upload`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: cookieHeader,
        'X-YAQANA-CSRF-TOKEN': csrfToken
      },
      body: form
    });
    const uploadBody = await upload.json();
    assert.equal(upload.status, 200);
    assert.match(uploadBody.imageUrl, /^\/uploads\/yaqana-/);
    uploadedPath = path.join(uploadDirectory, path.basename(uploadBody.imageUrl));

    const uploadedImage = await fetch(`http://127.0.0.1:${server.address().port}${uploadBody.imageUrl}`);
    assert.equal(uploadedImage.status, 200);
    assert.deepEqual(Buffer.from(await uploadedImage.arrayBuffer()), imageBytes);

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
    assert.ok(logout.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`) && /Expires=.*1970/i.test(cookie)));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (uploadedPath) await unlink(uploadedPath);
    if (user) {
      await Session.deleteMany({ user: user._id });
      await User.deleteOne({ _id: user._id });
    }
    if (mongoose.connection.readyState) await disconnectDatabase();
  }
});
