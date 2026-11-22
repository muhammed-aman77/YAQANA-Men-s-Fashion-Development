import test from 'node:test';
import assert from 'node:assert/strict';
import User from '../src/models/User.js';
import { discardExpiredAdminMfaReplacements } from '../src/services/adminMfaReplacementCleanup.js';

test('abandoned authenticator replacement is discarded after expiry without touching the active factor', async (t) => {
  const account = {
    mfaEnabled: true,
    mfaSecretEncrypted: 'active-encrypted-factor',
    mfaReplacementSecretEncrypted: 'expired-encrypted-pending-factor',
    mfaReplacementChallengeId: 'abandoned-challenge',
    mfaReplacementSessionId: 'session-id',
    mfaReplacementExpiresAt: new Date('2026-11-21T11:59:59.000Z')
  };
  let filter;
  let update;
  t.mock.method(User, 'updateMany', async (query, changes) => {
    filter = query;
    update = changes;
    if (account.mfaReplacementExpiresAt <= query.mfaReplacementExpiresAt.$lte) {
      for (const field of Object.keys(changes.$unset)) delete account[field];
    }
    return { modifiedCount: 1 };
  });

  const now = new Date('2026-11-21T12:00:00.000Z');
  const result = await discardExpiredAdminMfaReplacements(now);

  assert.equal(result.modifiedCount, 1);
  assert.equal(filter.mfaReplacementSecretEncrypted.$type, 'string');
  assert.equal(filter.mfaReplacementExpiresAt.$lte, now);
  assert.deepEqual(Object.keys(update.$unset).sort(), [
    'mfaReplacementChallengeId',
    'mfaReplacementExpiresAt',
    'mfaReplacementSecretEncrypted',
    'mfaReplacementSessionId'
  ].sort());
  assert.equal(Object.hasOwn(update.$unset, 'mfaSecretEncrypted'), false);
  assert.equal(Object.hasOwn(update.$set || {}, 'mfaEnabled'), false);
  assert.equal(account.mfaReplacementSecretEncrypted, undefined);
  assert.equal(account.mfaReplacementChallengeId, undefined);
  assert.equal(account.mfaEnabled, true);
  assert.equal(account.mfaSecretEncrypted, 'active-encrypted-factor');
});
