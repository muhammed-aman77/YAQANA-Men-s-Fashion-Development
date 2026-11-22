import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin, requireRecentAdminReauthentication } from '../src/middleware/auth.js';

const checkAdminAccess = (user, session = null) => new Promise((resolve) => {
  requireAdmin({ user, session }, {}, resolve);
});

test('customer accounts are denied administrator authorization', async () => {
  const error = await checkAdminAccess({ role: 'customer' });
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, 'ADMIN_REQUIRED');
});

test('administrator accounts pass the administrator authorization middleware', async () => {
  assert.equal(await checkAdminAccess({ role: 'admin' }, { mfaVerifiedAt: new Date() }), undefined);
});

test('administrator role without an MFA-verified session is denied', async () => {
  const error = await checkAdminAccess({ role: 'owner' }, { mfaVerifiedAt: null });
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, 'ADMIN_MFA_REQUIRED');
});

test('sensitive administrator changes require reauthentication within five minutes', async () => {
  const recent = await new Promise((resolve) => requireRecentAdminReauthentication({ session: { mfaReauthenticatedAt: new Date() } }, {}, resolve));
  const stale = await new Promise((resolve) => requireRecentAdminReauthentication({ session: { mfaReauthenticatedAt: new Date(Date.now() - 5 * 60_001) } }, {}, resolve));
  assert.equal(recent, undefined);
  assert.equal(stale.code, 'ADMIN_REAUTHENTICATION_REQUIRED');
});
