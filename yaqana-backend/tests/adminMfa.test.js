import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecoveryCodes,
  createTotpCode,
  createTotpSecret,
  buildTotpUri,
  decryptMfaSecret,
  encryptMfaSecret,
  verifyTotp
} from '../src/utils/adminMfa.js';
import { issueAdminAuthChallenge, verifyAdminAuthChallenge } from '../src/utils/adminAuthChallenge.js';
import User from '../src/models/User.js';

test('TOTP accepts the current code once and rejects a replayed counter', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const now = 1_700_000_000_000;
  const code = createTotpCode(secret, now);
  const counter = verifyTotp(secret, code, now, -1);
  assert.equal(counter, Math.floor(now / 30_000));
  assert.equal(verifyTotp(secret, code, now, counter), null);
});

test('TOTP rejects malformed codes and accepts bounded clock drift', () => {
  const secret = createTotpSecret();
  const now = 1_700_000_000_000;
  assert.equal(verifyTotp(secret, 'not-a-code', now), null);
  assert.equal(verifyTotp(secret, '123', now), null);
  assert.equal(verifyTotp(secret, createTotpCode(secret, now + 30_000), now), Math.floor(now / 30_000) + 1);
});

test('TOTP rejects a code that is more than one 30-second window old', () => {
  const secret = createTotpSecret();
  const now = 1_700_000_000_000;
  const expiredCode = createTotpCode(secret, now - 60_000);
  assert.equal(verifyTotp(secret, expiredCode, now, -1), null);
});

test('Google Authenticator URI uses the required issuer, label, SHA1, six digits, and 30-second period', () => {
  const uri = new URL(buildTotpUri('admin@example.test', 'A'.repeat(32)));
  assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.hostname, 'totp');
  assert.equal(decodeURIComponent(uri.pathname.slice(1)), 'YAQANA Admin:admin@example.test');
  assert.equal(uri.searchParams.get('issuer'), 'YAQANA');
  assert.equal(uri.searchParams.get('algorithm'), 'SHA1');
  assert.equal(uri.searchParams.get('digits'), '6');
  assert.equal(uri.searchParams.get('period'), '30');
  assert.equal(uri.searchParams.get('secret'), 'A'.repeat(32));
});

test('TOTP secret encryption round-trips and rejects altered ciphertext or weak keys', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const encrypted = encryptMfaSecret('secret-seed', key);
  assert.equal(decryptMfaSecret(encrypted, key), 'secret-seed');
  const [version, iv, tag, ciphertext] = encrypted.split('.');
  const alteredTag = `${tag[0] === 'A' ? 'B' : 'A'}${tag.slice(1)}`;
  assert.throws(() => decryptMfaSecret(`${version}.${iv}.${alteredTag}.${ciphertext}`, key));
  assert.throws(() => encryptMfaSecret('secret-seed', 'weak'));
});

test('recovery codes are unique, sufficiently random, and returned only as raw values', () => {
  const codes = createRecoveryCodes(10);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.ok(codes.every((code) => /^[A-Za-z0-9_-]{20,}$/.test(code)));
});

test('admin challenge tokens are purpose-bound, short-lived, and signed', () => {
  const secret = 'test-only-secret-that-is-at-least-thirty-two-characters-long';
  const issuedAt = 1_700_000_000_000;
  const challenge = issueAdminAuthChallenge({ userId: 'staff-1', challengeId: 'challenge-1', purpose: 'mfa', secret, now: issuedAt });
  assert.deepEqual(verifyAdminAuthChallenge(challenge.token, secret, issuedAt + 1), {
    sub: 'staff-1', challengeId: 'challenge-1', purpose: 'mfa', exp: challenge.expiresAt
  });
  assert.equal(verifyAdminAuthChallenge(challenge.token, secret, challenge.expiresAt * 1000), null);
  assert.equal(verifyAdminAuthChallenge(challenge.token, `${secret}bad`, issuedAt + 1), null);
});

test('user schema protects MFA material and permits one Owner identity', () => {
  for (const field of ['mfaLastCounter', 'mfaSecretEncrypted', 'mfaSetupSecretEncrypted', 'mfaReplacementSecretEncrypted', 'mfaReplacementChallengeId', 'mfaReplacementExpiresAt', 'mfaReplacementSessionId', 'mfaRecoveryCodeHashes', 'adminAuthChallengeId', 'adminAuthChallengeExpiresAt']) {
    assert.equal(User.schema.path(field).options.select, false, `${field} must be excluded by default`);
  }
  const ownerIndex = User.schema.indexes().find(([keys, options]) => keys.role === 1 && options.name === 'unique_owner_identity');
  assert.equal(ownerIndex?.[1].unique, true);
  assert.deepEqual(ownerIndex?.[1].partialFilterExpression, { role: 'owner' });
});
