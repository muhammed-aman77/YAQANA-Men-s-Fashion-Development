import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  createCsrfTokenHash,
  createSessionCookieOptions,
  getCookieValue,
  verifyCsrfToken
} from '../src/utils/cookieAuth.js';
import { requireCsrfForCookieAuth } from '../src/middleware/auth.js';

test('session cookies are host-only, HttpOnly and secure in production', () => {
  const options = createSessionCookieOptions({ production: true, maxAgeMs: 60_000 });

  assert.equal(SESSION_COOKIE_NAME, 'yaqana_session');
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.path, '/');
  assert.equal(options.maxAge, 60_000);
  assert.equal(Object.hasOwn(options, 'domain'), false);
});

test('cookie lookup decodes only the requested cookie value', () => {
  assert.equal(
    getCookieValue('theme=light; yaqana_csrf=a%2Bb%3D%3D; other=value', CSRF_COOKIE_NAME),
    'a+b=='
  );
  assert.equal(getCookieValue('not_yaqana_csrf=wrong', CSRF_COOKIE_NAME), null);
});

test('cookie-authenticated writes require the matching session-bound CSRF token', () => {
  const token = 'csrf-session-token';
  const tokenHash = createCsrfTokenHash(token);

  assert.equal(verifyCsrfToken(tokenHash, token, token), true);
  assert.equal(verifyCsrfToken(tokenHash, token, 'different-token'), false);
  assert.equal(verifyCsrfToken(tokenHash, null, token), false);
  assert.equal(verifyCsrfToken(tokenHash, token, null), false);
  assert.equal(verifyCsrfToken('not-a-hash', token, token), false);
});

test('CSRF middleware blocks cookie-authenticated writes but leaves reads and bearer requests alone', () => {
  const token = 'middleware-csrf-token';
  const session = { csrfTokenHash: createCsrfTokenHash(token) };
  const validRequest = {
    authSource: 'cookie',
    method: 'POST',
    headers: {
      cookie: `${CSRF_COOKIE_NAME}=${token}`,
      'x-yaqana-csrf-token': token
    },
    session
  };
  let validError;
  requireCsrfForCookieAuth(validRequest, {}, (error) => { validError = error; });
  assert.equal(validError, undefined);

  let rejected;
  requireCsrfForCookieAuth({ ...validRequest, headers: { cookie: `${CSRF_COOKIE_NAME}=${token}` } }, {}, (error) => { rejected = error; });
  assert.equal(rejected?.statusCode, 403);
  assert.equal(rejected?.code, 'CSRF_VALIDATION_FAILED');

  assert.doesNotThrow(() => requireCsrfForCookieAuth({ ...validRequest, method: 'GET' }, {}, (error) => {
    if (error) throw error;
  }));
  assert.doesNotThrow(() => requireCsrfForCookieAuth({ ...validRequest, authSource: 'bearer' }, {}, (error) => {
    if (error) throw error;
  }));
});
