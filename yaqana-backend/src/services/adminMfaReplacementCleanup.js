import User from '../models/User.js';

export function discardExpiredAdminMfaReplacements(now = new Date()) {
  return User.updateMany({
    mfaReplacementSecretEncrypted: { $type: 'string' },
    mfaReplacementExpiresAt: { $lte: now }
  }, {
    $unset: {
      mfaReplacementSecretEncrypted: '',
      mfaReplacementChallengeId: '',
      mfaReplacementExpiresAt: '',
      mfaReplacementSessionId: ''
    }
  });
}

export async function startAdminMfaReplacementCleanup() {
  await discardExpiredAdminMfaReplacements();
  const timer = setInterval(() => {
    discardExpiredAdminMfaReplacements().catch(() => {
      console.error('Expired administrator MFA replacement cleanup failed.');
    });
  }, 30_000);
  timer.unref();
  return timer;
}
