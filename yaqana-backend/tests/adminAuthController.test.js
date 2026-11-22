import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import User from '../src/models/User.js';
import Session from '../src/models/Session.js';
import AdminAudit from '../src/models/AdminAudit.js';
import { hashPassword } from '../src/utils/password.js';
import { createTotpCode, decryptMfaSecret, encryptMfaSecret, normalizeRecoveryCode } from '../src/utils/adminMfa.js';

process.env.MFA_ENCRYPTION_KEY ||= Buffer.alloc(32, 9).toString('base64');
const { beginAdminLogin, completeAdminMfa, beginAdminMfaReplacement, completeAdminMfaReplacement, reauthenticateAdmin, revokeOtherAdminSessions } = await import('../src/controllers/adminAuthController.js');

async function listen(handler) {
  const app = express();
  app.use(express.json());
  app.post('/admin-auth/login', beginAdminLogin);
  app.post('/admin-auth/verify', completeAdminMfa);
  app.post('/admin-auth/reauthenticate', (req, _res, next) => {
    req.user = { _id: req.body.testUserId, role: 'owner' };
    req.session = { _id: req.body.testSessionId, revokedAt: null };
    next();
  }, reauthenticateAdmin);
  app.post('/admin-auth/revoke-others', (req, _res, next) => {
    req.user = { _id: req.body.testUserId, role: 'admin' };
    req.session = { _id: req.body.testSessionId, revokedAt: null };
    next();
  }, revokeOtherAdminSessions);
  app.post('/admin-auth/mfa/replacement/start', (req, _res, next) => {
    req.user = { _id: req.body.testUserId, role: 'admin' };
    req.session = { _id: req.body.testSessionId || 'current-admin-session', mfaVerifiedAt: new Date() };
    next();
  }, beginAdminMfaReplacement);
  app.post('/admin-auth/mfa/replacement/verify', (req, _res, next) => {
    req.user = { _id: req.body.testUserId, role: 'admin' };
    req.session = { _id: req.body.testSessionId || 'current-admin-session', mfaVerifiedAt: new Date() };
    next();
  }, completeAdminMfaReplacement);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code, message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}/admin-auth` };
}

test('admin password begins an MFA enrollment challenge without creating a session', async (t) => {
  const user = {
    _id: 'admin-user-1', email: 'staff@example.test', role: 'admin', status: 'active', mfaEnabled: false,
    passwordHash: await hashPassword('valid-password'), save: async () => {}
  };
  t.mock.method(User, 'findOne', () => ({ select: async () => user }));
  t.mock.method(Session, 'create', async () => { throw new Error('A session must not exist before MFA.'); });
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'valid-password' })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  assert.equal(body.status, 'mfa_setup_required');
  assert.ok(body.challengeToken);
  assert.match(body.secret, /^[A-Z2-7]{32}$/u);
  assert.ok(body.otpauthUrl.startsWith('otpauth://totp/'));
  assert.ok(user.mfaSetupSecretEncrypted);
  assert.ok(user.adminAuthChallengeId);
});

test('first MFA verification enables TOTP, hashes recovery codes, audits and only then creates a session', async (t) => {
  const user = {
    _id: 'admin-user-2', email: 'owner-eligible@example.test', role: 'admin', status: 'active', mfaEnabled: false,
    passwordHash: await hashPassword('valid-password'), mfaLastCounter: -1,
    save: async () => {}
  };
  let sessionRecord;
  let auditRecord;
  let enrollmentFilter;
  t.mock.method(User, 'findOne', () => ({ select: async () => user }));
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(User, 'findOneAndUpdate', async (filter, update) => {
    enrollmentFilter = filter;
    user.mfaEnabled = update.$set.mfaEnabled;
    user.mfaSecretEncrypted = update.$set.mfaSecretEncrypted;
    user.mfaRecoveryCodeHashes = update.$set.mfaRecoveryCodeHashes;
    user.mfaLastCounter = update.$set.mfaLastCounter;
    user.mfaSetupSecretEncrypted = null;
    user.adminAuthChallengeId = null;
    user.adminAuthChallengeExpiresAt = null;
    return user;
  });
  t.mock.method(Session, 'create', async (record) => { sessionRecord = record; });
  t.mock.method(AdminAudit, 'create', async (record) => { auditRecord = record; });
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const challengeResponse = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'valid-password' })
  });
  const challenge = await challengeResponse.json();
  const issuedChallengeId = user.adminAuthChallengeId;
  const verifyResponse = await fetch(`${base}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken: challenge.challengeToken, code: createTotpCode(challenge.secret) })
  });
  const result = await verifyResponse.json();

  assert.equal(verifyResponse.status, 200);
  assert.equal(verifyResponse.headers.get('cache-control'), 'no-store, private');
  assert.equal(result.user.role, 'admin');
  assert.equal(result.user.adminMfaVerified, true);
  assert.equal(result.recoveryCodes.length, 10);
  assert.ok(user.mfaEnabled);
  assert.equal(enrollmentFilter.adminAuthChallengeId, issuedChallengeId);
  assert.ok(enrollmentFilter.adminAuthChallengeExpiresAt.$gt instanceof Date);
  assert.equal(enrollmentFilter.mfaEnabled.$ne, true);
  assert.equal(user.mfaRecoveryCodeHashes.length, 10);
  assert.ok(user.mfaRecoveryCodeHashes.every((hash) => hash.startsWith('scrypt$')));
  assert.equal(user.mfaRecoveryCodeHashes.includes(result.recoveryCodes[0]), false);
  assert.ok(sessionRecord.mfaVerifiedAt instanceof Date);
  assert.equal(auditRecord.action, 'auth.admin.mfa.enroll');
});

test('incorrect enrollment code is rejected without enabling MFA or creating a session', async (t) => {
  const user = {
    _id: 'admin-wrong-code', email: 'wrong-code@example.test', role: 'admin', status: 'active', mfaEnabled: false,
    passwordHash: await hashPassword('valid-password'), save: async () => {}
  };
  let sessionCreated = false;
  t.mock.method(User, 'findOne', () => ({ select: async () => user }));
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(Session, 'create', async () => { sessionCreated = true; });
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const login = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'valid-password' })
  });
  const challenge = await login.json();
  const correct = Number(createTotpCode(challenge.secret));
  const incorrectCode = String((correct + 1) % 1_000_000).padStart(6, '0');
  const verify = await fetch(`${base}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken: challenge.challengeToken, code: incorrectCode })
  });
  assert.equal(verify.status, 401);
  assert.equal((await verify.json()).code, 'MFA_CODE_INVALID');
  assert.equal(user.mfaEnabled, false);
  assert.equal(sessionCreated, false);
});

test('expired database enrollment challenge is rejected before session creation', async (t) => {
  const user = {
    _id: 'admin-expired-challenge', email: 'expired@example.test', role: 'admin', status: 'active', mfaEnabled: false,
    passwordHash: await hashPassword('valid-password'), save: async () => {}
  };
  let sessionCreated = false;
  t.mock.method(User, 'findOne', () => ({ select: async () => user }));
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(Session, 'create', async () => { sessionCreated = true; });
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const login = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'valid-password' })
  });
  const challenge = await login.json();
  user.adminAuthChallengeExpiresAt = new Date(Date.now() - 1);
  const verify = await fetch(`${base}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken: challenge.challengeToken, code: '000000' })
  });
  assert.equal(verify.status, 401);
  assert.equal((await verify.json()).code, 'ADMIN_CHALLENGE_INVALID');
  assert.equal(sessionCreated, false);
});

test('customer accounts cannot use the separate administrator login', async (t) => {
  const user = {
    _id: 'customer-1', email: 'customer@example.test', role: 'customer', status: 'active',
    passwordHash: await hashPassword('valid-password')
  };
  t.mock.method(User, 'findOne', () => ({ select: async () => user }));
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'valid-password' })
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'INVALID_CREDENTIALS');
});

test('enrolled administrator completes MFA and challenge use is atomically consumed', async (t) => {
  const key = process.env.MFA_ENCRYPTION_KEY;
  const secret = 'JBSWY3DPEHPK3PXP';
  const user = {
    _id: 'admin-user-3', email: 'enrolled@example.test', role: 'owner', status: 'active', mfaEnabled: true,
    passwordHash: await hashPassword('valid-password'), mfaSecretEncrypted: encryptMfaSecret(secret, key),
    mfaLastCounter: -1, save: async () => {}
  };
  let atomicQuery;
  let sessionRecord;
  t.mock.method(User, 'findOne', () => ({ select: async () => user }));
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(User, 'findOneAndUpdate', async (query, update) => {
    atomicQuery = query;
    user.mfaLastCounter = update.$set.mfaLastCounter;
    user.adminAuthChallengeId = null;
    return user;
  });
  t.mock.method(Session, 'create', async (record) => { sessionRecord = record; });
  t.mock.method(AdminAudit, 'create', async () => ({}));
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const challengeResponse = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'valid-password' })
  });
  const challenge = await challengeResponse.json();
  assert.equal(challenge.status, 'mfa_required');
  const response = await fetch(`${base}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken: challenge.challengeToken, code: createTotpCode(secret) })
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.user.role, 'owner');
  assert.equal(result.user.adminMfaVerified, true);
  assert.equal(typeof atomicQuery.adminAuthChallengeId, 'string');
  assert.ok(atomicQuery.adminAuthChallengeExpiresAt.$gt instanceof Date);
  assert.equal(sessionRecord.mfaVerifiedAt instanceof Date, true);
});

test('recovery-code login consumes the matching hash and rejects replay', async (t) => {
  const key = process.env.MFA_ENCRYPTION_KEY;
  const recoveryCode = 'one-time-recovery-code-123';
  const recoveryHash = await hashPassword(normalizeRecoveryCode(recoveryCode));
  const user = {
    _id: 'admin-user-4', email: 'recovery@example.test', role: 'admin', status: 'active', mfaEnabled: true,
    passwordHash: await hashPassword('valid-password'), mfaSecretEncrypted: encryptMfaSecret('JBSWY3DPEHPK3PXP', key),
    mfaLastCounter: -1, mfaRecoveryCodeHashes: [recoveryHash], save: async () => {}
  };
  let pulledHash;
  t.mock.method(User, 'findOne', () => ({ select: async () => user }));
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(User, 'findOneAndUpdate', async (query, update) => {
    pulledHash = update.$pull.mfaRecoveryCodeHashes;
    if (query.mfaRecoveryCodeHashes !== recoveryHash || user.mfaRecoveryCodeHashes.length === 0) return null;
    user.mfaRecoveryCodeHashes = [];
    user.adminAuthChallengeId = null;
    return user;
  });
  t.mock.method(Session, 'create', async () => ({}));
  t.mock.method(Session, 'updateMany', async () => ({ modifiedCount: 1 }));
  t.mock.method(AdminAudit, 'create', async () => ({}));
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const loginResponse = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'valid-password' })
  });
  const challenge = await loginResponse.json();
  const verify = () => fetch(`${base}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken: challenge.challengeToken, recoveryCode })
  });
  const first = await verify();
  assert.equal(first.status, 200);
  assert.equal(pulledHash, recoveryHash);
  const secondLoginResponse = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'valid-password' })
  });
  const secondChallenge = await secondLoginResponse.json();
  const replay = await fetch(`${base}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken: secondChallenge.challengeToken, recoveryCode })
  });
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).code, 'MFA_CODE_INVALID');
});

test('owner reauthentication records a fresh session step-up without exposing MFA material', async (t) => {
  const user = {
    _id: 'owner-reauth', email: 'owner@example.test', role: 'owner', status: 'active',
    passwordHash: await hashPassword('valid-password'), mfaEnabled: true,
    mfaSecretEncrypted: encryptMfaSecret('JBSWY3DPEHPK3PXP', process.env.MFA_ENCRYPTION_KEY), mfaLastCounter: -1
  };
  let sessionUpdate;
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(User, 'findOneAndUpdate', async () => user);
  t.mock.method(Session, 'updateOne', async (filter, update) => { sessionUpdate = { filter, update }; return { matchedCount: 1 }; });
  t.mock.method(AdminAudit, 'create', async () => ({}));
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${base}/reauthenticate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      testUserId: user._id,
      testSessionId: 'session-current',
      currentPassword: 'valid-password',
      code: createTotpCode('JBSWY3DPEHPK3PXP'),
      purpose: 'ownership_transfer'
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.validForSeconds, 300);
  assert.equal(sessionUpdate.filter._id, 'session-current');
  assert.ok(sessionUpdate.update.$set.mfaReauthenticatedAt instanceof Date);
  assert.equal(JSON.stringify(body).includes('secret'), false);
});

test('session revocation preserves only the current session and records the affected count', async (t) => {
  let filter;
  let audit;
  t.mock.method(Session, 'updateMany', async (query) => { filter = query; return { modifiedCount: 3 }; });
  t.mock.method(AdminAudit, 'create', async (record) => { audit = record; });
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${base}/revoke-others`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testUserId: 'admin-5', testSessionId: 'current-session' })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revokedCount, 3);
  assert.equal(filter.user, 'admin-5');
  assert.equal(filter._id.$ne, 'current-session');
  assert.equal(audit.action, 'auth.admin.sessions.revoke_others');
});

function applyUserUpdate(user, update) {
  Object.assign(user, update.$set || {});
  for (const [field, value] of Object.entries(update.$pull || {})) {
    user[field] = (user[field] || []).filter((entry) => entry !== value);
  }
  for (const field of Object.keys(update.$unset || {})) delete user[field];
  return user;
}

function replacementUser(id = 'admin-mfa-replacement') {
  return {
    _id: id,
    email: 'admin@example.test',
    role: 'admin',
    status: 'active',
    mfaEnabled: true,
    passwordHash: '$scrypt$fixture',
    mfaSecretEncrypted: encryptMfaSecret('JBSWY3DPEHPK3PXP', process.env.MFA_ENCRYPTION_KEY),
    mfaRecoveryCodeHashes: [],
    mfaLastCounter: -1
  };
}

async function beginReplacement(base, user, { currentPassword = 'valid-password', code, recoveryCode, testSessionId } = {}) {
  return fetch(`${base}/mfa/replacement/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testUserId: user._id, testSessionId, currentPassword, code, recoveryCode })
  });
}

test('authenticator replacement preserves the old factor until a new authenticator code succeeds', async (t) => {
  const user = replacementUser();
  user.passwordHash = await hashPassword('valid-password');
  const oldEncrypted = user.mfaSecretEncrypted;
  let auditEvents = [];
  let sessionFilter;
  let atomicUpdateCount = 0;
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(User, 'findOneAndUpdate', async (_filter, update) => {
    atomicUpdateCount += 1;
    return applyUserUpdate(user, update);
  });
  t.mock.method(Session, 'updateMany', async (filter) => { sessionFilter = filter; return { modifiedCount: 2 }; });
  t.mock.method(AdminAudit, 'create', async (record) => { auditEvents.push(record); return record; });
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const start = await beginReplacement(base, user, { code: createTotpCode('JBSWY3DPEHPK3PXP') });
  const setup = await start.json();
  assert.equal(start.status, 200);
  assert.equal(start.headers.get('cache-control'), 'no-store, private');
  assert.match(setup.otpauthUrl, /issuer=YAQANA/u);
  assert.match(setup.otpauthUrl, /algorithm=SHA1/u);
  assert.match(setup.otpauthUrl, /digits=6/u);
  assert.match(setup.otpauthUrl, /period=30/u);
  const oldCodeReplay = await beginReplacement(base, user, { code: createTotpCode('JBSWY3DPEHPK3PXP') });
  assert.equal(oldCodeReplay.status, 401);
  assert.equal((await oldCodeReplay.json()).code, 'REAUTHENTICATION_FAILED');
  const replacementSecret = decryptMfaSecret(user.mfaReplacementSecretEncrypted, process.env.MFA_ENCRYPTION_KEY);
  assert.notEqual(replacementSecret, 'JBSWY3DPEHPK3PXP');
  assert.equal(user.mfaSecretEncrypted, oldEncrypted);
  const newCode = createTotpCode(replacementSecret);
  const wrongCode = String((Number(newCode) + 1) % 1_000_000).padStart(6, '0');
  const failed = await fetch(`${base}/mfa/replacement/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testUserId: user._id, challengeId: setup.challengeId, code: wrongCode })
  });
  assert.equal(failed.status, 401);
  assert.equal(user.mfaSecretEncrypted, oldEncrypted);
  assert.equal(user.mfaEnabled, true);

  const verified = await fetch(`${base}/mfa/replacement/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testUserId: user._id, challengeId: setup.challengeId, code: newCode })
  });
  const result = await verified.json();
  assert.equal(verified.status, 200);
  assert.equal(decryptMfaSecret(user.mfaSecretEncrypted, process.env.MFA_ENCRYPTION_KEY), replacementSecret);
  assert.equal(user.mfaEnabled, true);
  assert.equal(user.role, 'admin');
  assert.equal(user.status, 'active');
  assert.equal(user.mfaReplacementSecretEncrypted, undefined);
  assert.equal(result.recoveryCodes.length, 10);
  assert.equal(sessionFilter._id.$ne, 'current-admin-session');
  assert.ok(auditEvents.some(({ action }) => action === 'auth.admin.mfa.replacement.completed'));
  assert.equal(JSON.stringify(auditEvents).includes(replacementSecret), false);
  assert.equal(atomicUpdateCount, 2);
});

test('replacement rejects an incorrect password without changing the old authenticator', async (t) => {
  const user = replacementUser('admin-mfa-replacement-bad-password');
  user.passwordHash = await hashPassword('valid-password');
  const oldEncrypted = user.mfaSecretEncrypted;
  let updated = false;
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(User, 'findOneAndUpdate', async () => { updated = true; return user; });
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await beginReplacement(base, user, { currentPassword: 'wrong-password', code: '123456' });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'REAUTHENTICATION_FAILED');
  assert.equal(updated, false);
  assert.equal(user.mfaSecretEncrypted, oldEncrypted);
});

test('replacement rejects an incorrect current authenticator code without changing the old factor', async (t) => {
  const user = replacementUser('admin-mfa-replacement-bad-current-code');
  user.passwordHash = await hashPassword('valid-password');
  const oldEncrypted = user.mfaSecretEncrypted;
  let updated = false;
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(User, 'findOneAndUpdate', async () => { updated = true; return user; });
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await beginReplacement(base, user, { code: '123456' });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'REAUTHENTICATION_FAILED');
  assert.equal(updated, false);
  assert.equal(user.mfaSecretEncrypted, oldEncrypted);
});

test('replacement consumes a recovery code once as alternate proof', async (t) => {
  const user = replacementUser('admin-mfa-replacement-recovery');
  user.passwordHash = await hashPassword('valid-password');
  const recoveryCode = 'single-use-replacement-recovery-code';
  const recoveryHash = await hashPassword(normalizeRecoveryCode(recoveryCode));
  user.mfaRecoveryCodeHashes = [recoveryHash];
  let updateFilter;
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(User, 'findOneAndUpdate', async (filter, update) => {
    updateFilter = filter;
    return applyUserUpdate(user, update);
  });
  t.mock.method(Session, 'updateMany', async () => ({ modifiedCount: 1 }));
  t.mock.method(AdminAudit, 'create', async () => ({}));
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const first = await beginReplacement(base, user, { recoveryCode });
  assert.equal(first.status, 200);
  assert.equal(updateFilter.mfaRecoveryCodeHashes, recoveryHash);
  assert.deepEqual(user.mfaRecoveryCodeHashes, []);
  assert.equal(user.mfaEnabled, true);
  const replay = await beginReplacement(base, user, { recoveryCode });
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).code, 'REAUTHENTICATION_FAILED');
  assert.ok(user.mfaReplacementSecretEncrypted);
  const pendingSecret = decryptMfaSecret(user.mfaReplacementSecretEncrypted, process.env.MFA_ENCRYPTION_KEY);
  const verify = await fetch(`${base}/mfa/replacement/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testUserId: user._id, challengeId: user.mfaReplacementChallengeId, code: createTotpCode(pendingSecret) })
  });
  assert.equal(verify.status, 200);
  assert.notEqual(decryptMfaSecret(user.mfaSecretEncrypted, process.env.MFA_ENCRYPTION_KEY), 'JBSWY3DPEHPK3PXP');
  assert.equal(user.mfaRecoveryCodeHashes.length, 10);
});

test('expired replacement setup is discarded and leaves the old authenticator active', async (t) => {
  const user = replacementUser('admin-mfa-replacement-expired');
  user.mfaReplacementChallengeId = 'expired-replacement-challenge';
  user.mfaReplacementSecretEncrypted = encryptMfaSecret('replacement-pending', process.env.MFA_ENCRYPTION_KEY);
  user.mfaReplacementExpiresAt = new Date(Date.now() - 1);
  user.mfaReplacementSessionId = 'current-admin-session';
  const oldEncrypted = user.mfaSecretEncrypted;
  let expiredFilter;
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(User, 'updateOne', async (filter, update) => {
    expiredFilter = filter;
    return applyUserUpdate(user, update);
  });
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${base}/mfa/replacement/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testUserId: user._id, challengeId: 'expired-replacement-challenge', code: '123456' })
  });
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, 'MFA_REPLACEMENT_EXPIRED');
  assert.equal(expiredFilter.mfaReplacementChallengeId, 'expired-replacement-challenge');
  assert.equal(user.mfaReplacementSecretEncrypted, undefined);
  assert.equal(user.mfaSecretEncrypted, oldEncrypted);
  assert.equal(user.mfaEnabled, true);
});

test('a successful replacement challenge cannot be replayed', async (t) => {
  const user = replacementUser('admin-mfa-replacement-replay');
  user.passwordHash = await hashPassword('valid-password');
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(User, 'findOneAndUpdate', async (_filter, update) => applyUserUpdate(user, update));
  t.mock.method(Session, 'updateMany', async () => ({ modifiedCount: 0 }));
  t.mock.method(AdminAudit, 'create', async () => ({}));
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const start = await beginReplacement(base, user, { code: createTotpCode('JBSWY3DPEHPK3PXP') });
  const setup = await start.json();
  const pendingSecret = decryptMfaSecret(user.mfaReplacementSecretEncrypted, process.env.MFA_ENCRYPTION_KEY);
  const code = createTotpCode(pendingSecret);
  const send = () => fetch(`${base}/mfa/replacement/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testUserId: user._id, challengeId: setup.challengeId, code })
  });
  assert.equal((await send()).status, 200);
  const replay = await send();
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).code, 'MFA_REPLACEMENT_INVALID');
});

test('replacement challenge is bound to the Admin session that started it', async (t) => {
  const user = replacementUser('admin-mfa-replacement-session-binding');
  user.passwordHash = await hashPassword('valid-password');
  const oldEncrypted = user.mfaSecretEncrypted;
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(User, 'findOneAndUpdate', async (_filter, update) => applyUserUpdate(user, update));
  t.mock.method(Session, 'updateMany', async () => ({ modifiedCount: 0 }));
  t.mock.method(AdminAudit, 'create', async () => ({}));
  const { server, base } = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const start = await beginReplacement(base, user, {
    code: createTotpCode('JBSWY3DPEHPK3PXP'),
    testSessionId: 'session-that-started-replacement'
  });
  const setup = await start.json();
  const replacementSecret = decryptMfaSecret(user.mfaReplacementSecretEncrypted, process.env.MFA_ENCRYPTION_KEY);
  const verify = await fetch(`${base}/mfa/replacement/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      testUserId: user._id,
      testSessionId: 'different-admin-session',
      challengeId: setup.challengeId,
      code: createTotpCode(replacementSecret)
    })
  });
  assert.equal(verify.status, 401);
  assert.equal((await verify.json()).code, 'MFA_REPLACEMENT_INVALID');
  assert.equal(user.mfaSecretEncrypted, oldEncrypted);
  assert.equal(user.mfaEnabled, true);
});
