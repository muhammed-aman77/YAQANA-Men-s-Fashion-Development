import { randomUUID } from 'node:crypto';
import AdminAudit from '../models/AdminAudit.js';
import Session from '../models/Session.js';
import User from '../models/User.js';
import { createSession } from './authController.js';
import { env } from '../config/env.js';
import { asyncHandler, httpError } from '../utils/http.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import {
  buildTotpUri,
  createRecoveryCodes,
  createTotpSecret,
  decryptMfaSecret,
  encryptMfaSecret,
  normalizeRecoveryCode,
  verifyTotp
} from '../utils/adminMfa.js';
import { issueAdminAuthChallenge, verifyAdminAuthChallenge } from '../utils/adminAuthChallenge.js';

const STAFF_ROLES = ['support_agent', 'admin', 'owner'];
const CHALLENGE_TTL_MS = 5 * 60_000;

function preventMfaMaterialCaching(res) {
  res.set('Cache-Control', 'no-store, private');
  res.set('Pragma', 'no-cache');
}

function ensureMfaKey() {
  try {
    encryptMfaSecret('configuration-check', env.MFA_ENCRYPTION_KEY);
  } catch {
    throw httpError(503, 'Administrator MFA is not configured. Set a stable MFA_ENCRYPTION_KEY before allowing administrator sign-in.', 'MFA_CONFIGURATION_REQUIRED');
  }
}

function issueChallenge(user, purpose, challengeId, now) {
  return issueAdminAuthChallenge({ userId: user._id, challengeId, purpose, secret: env.JWT_SECRET, now });
}

function discardReplacementIfExpired(userId, challengeId, sessionId, now) {
  return User.updateOne({
    _id: userId,
    mfaReplacementChallengeId: challengeId,
    mfaReplacementSessionId: sessionId,
    mfaReplacementExpiresAt: { $lte: now }
  }, { $unset: {
    mfaReplacementSecretEncrypted: '',
    mfaReplacementChallengeId: '',
    mfaReplacementExpiresAt: '',
    mfaReplacementSessionId: ''
  } });
}

export const beginAdminLogin = asyncHandler(async (req, res) => {
  preventMfaMaterialCaching(res);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = await User.findOne({ email }).select('+passwordHash +mfaSecretEncrypted +mfaSetupSecretEncrypted');
  if (!user || !STAFF_ROLES.includes(user.role) || user.status !== 'active' || !await verifyPassword(password, user.passwordHash)) {
    throw httpError(401, 'Invalid administrator credentials.', 'INVALID_CREDENTIALS');
  }
  ensureMfaKey();

  const now = new Date();
  const challengeId = randomUUID();
  const challengeExpiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const enrollmentRequired = user.mfaEnabled !== true;
  let setupSecret;
  if (enrollmentRequired) {
    setupSecret = createTotpSecret();
    user.mfaSetupSecretEncrypted = encryptMfaSecret(setupSecret, env.MFA_ENCRYPTION_KEY);
  } else if (!user.mfaSecretEncrypted) {
    throw httpError(503, 'Administrator MFA needs controlled recovery before sign-in can continue.', 'ADMIN_MFA_REPAIR_REQUIRED');
  }
  user.adminAuthChallengeId = challengeId;
  user.adminAuthChallengeExpiresAt = challengeExpiresAt;
  await user.save();

  const challenge = issueChallenge(user, enrollmentRequired ? 'enrollment' : 'mfa', challengeId, now.getTime());
  res.status(200).json({
    success: true,
    status: enrollmentRequired ? 'mfa_setup_required' : 'mfa_required',
    challengeToken: challenge.token,
    expiresAt: challenge.expiresAt,
    ...(enrollmentRequired ? {
      secret: setupSecret,
      otpauthUrl: buildTotpUri(user.email, setupSecret)
    } : {})
  });
});

export const completeAdminMfa = asyncHandler(async (req, res) => {
  preventMfaMaterialCaching(res);
  const challenge = verifyAdminAuthChallenge(req.body?.challengeToken, env.JWT_SECRET);
  if (!challenge) throw httpError(401, 'Administrator sign-in challenge is invalid or expired.', 'ADMIN_CHALLENGE_INVALID');
  ensureMfaKey();
  let user = await User.findById(challenge.sub).select('+mfaSecretEncrypted +mfaSetupSecretEncrypted +mfaRecoveryCodeHashes +mfaLastCounter +adminAuthChallengeId +adminAuthChallengeExpiresAt');
  const now = new Date();
  if (!user || !STAFF_ROLES.includes(user.role) || user.status !== 'active' || user.adminAuthChallengeId !== challenge.challengeId || !user.adminAuthChallengeExpiresAt || user.adminAuthChallengeExpiresAt <= now) {
    throw httpError(401, 'Administrator sign-in challenge is invalid or expired.', 'ADMIN_CHALLENGE_INVALID');
  }

  const recoveryCode = normalizeRecoveryCode(req.body?.recoveryCode);
  const suppliedCode = String(req.body?.code || '').trim();
  let recoveryCodes;
  let method = 'totp';

  if (challenge.purpose === 'enrollment') {
    if (user.mfaEnabled === true || !user.mfaSetupSecretEncrypted) throw httpError(401, 'Administrator sign-in challenge is invalid or expired.', 'ADMIN_CHALLENGE_INVALID');
    const setupSecret = decryptMfaSecret(user.mfaSetupSecretEncrypted, env.MFA_ENCRYPTION_KEY);
    const counter = verifyTotp(setupSecret, suppliedCode, now.getTime(), -1);
    if (counter === null) throw httpError(401, 'The authenticator code is invalid.', 'MFA_CODE_INVALID');
    recoveryCodes = createRecoveryCodes();
    const recoveryHashes = [];
    for (const code of recoveryCodes) recoveryHashes.push(await hashPassword(normalizeRecoveryCode(code)));
    const enrolledUser = await User.findOneAndUpdate({
      _id: user._id,
      role: { $in: STAFF_ROLES },
      status: 'active',
      mfaEnabled: { $ne: true },
      mfaSetupSecretEncrypted: user.mfaSetupSecretEncrypted,
      adminAuthChallengeId: challenge.challengeId,
      adminAuthChallengeExpiresAt: { $gt: now }
    }, {
      $set: {
        mfaEnabled: true,
        mfaSecretEncrypted: user.mfaSetupSecretEncrypted,
        mfaRecoveryCodeHashes: recoveryHashes,
        mfaLastCounter: counter
      },
      $unset: {
        mfaSetupSecretEncrypted: '',
        adminAuthChallengeId: '',
        adminAuthChallengeExpiresAt: ''
      }
    }, { new: true });
    if (!enrolledUser) throw httpError(401, 'Administrator sign-in challenge is invalid or expired.', 'ADMIN_CHALLENGE_INVALID');
    user = enrolledUser;
    await AdminAudit.create({
      actor: user._id,
      action: 'auth.admin.mfa.enroll',
      reason: 'Administrator enrolled an authenticator and recovery codes.',
      metadata: { method: 'totp' }
    });
  } else {
    if (user.mfaEnabled !== true || !user.mfaSecretEncrypted) throw httpError(401, 'Administrator sign-in challenge is invalid or expired.', 'ADMIN_CHALLENGE_INVALID');
    let updatedUser;
    if (recoveryCode) {
      for (const storedHash of user.mfaRecoveryCodeHashes || []) {
        if (await verifyPassword(recoveryCode, storedHash)) {
          updatedUser = await User.findOneAndUpdate({
            _id: user._id,
            role: { $in: STAFF_ROLES },
            status: 'active',
            mfaEnabled: true,
            adminAuthChallengeId: challenge.challengeId,
            adminAuthChallengeExpiresAt: { $gt: now },
            mfaRecoveryCodeHashes: storedHash
          }, {
            $pull: { mfaRecoveryCodeHashes: storedHash },
            $unset: { adminAuthChallengeId: '', adminAuthChallengeExpiresAt: '' }
          }, { new: true });
          if (updatedUser) method = 'recovery_code';
          break;
        }
      }
    } else {
      const secret = decryptMfaSecret(user.mfaSecretEncrypted, env.MFA_ENCRYPTION_KEY);
      const lastCounter = Number.isSafeInteger(user.mfaLastCounter) ? user.mfaLastCounter : -1;
      const counter = verifyTotp(secret, suppliedCode, now.getTime(), lastCounter);
      if (counter !== null) {
        updatedUser = await User.findOneAndUpdate({
          _id: user._id,
          role: { $in: STAFF_ROLES },
          status: 'active',
          mfaEnabled: true,
          adminAuthChallengeId: challenge.challengeId,
          adminAuthChallengeExpiresAt: { $gt: now },
          $or: [{ mfaLastCounter: { $lt: counter } }, { mfaLastCounter: { $exists: false } }]
        }, {
          $set: { mfaLastCounter: counter },
          $unset: { adminAuthChallengeId: '', adminAuthChallengeExpiresAt: '' }
        }, { new: true });
      }
    }
    if (!updatedUser) throw httpError(401, 'The authenticator or recovery code is invalid or already used.', 'MFA_CODE_INVALID');
    if (method === 'recovery_code') {
      await Session.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: now } });
    }
    await AdminAudit.create({
      actor: user._id,
      action: 'auth.admin.mfa.login',
      reason: 'Administrator completed sign-in with multi-factor authentication.',
      metadata: { method }
    });
  }

  const response = await createSession(user, res, { mfaVerified: true });
  res.status(200).json({ ...response, ...(recoveryCodes ? { recoveryCodes } : {}) });
});

export const getAdminMfaStatus = asyncHandler(async (req, res) => {
  res.json({ success: true, enabled: req.user.mfaEnabled === true });
});

export const adminMfaRecovery = asyncHandler(async (req, res) => {
  preventMfaMaterialCaching(res);
  const currentPassword = String(req.body?.currentPassword || '');
  const code = String(req.body?.code || '');
  const user = await User.findById(req.user._id).select('+passwordHash +mfaSecretEncrypted +mfaLastCounter');
  if (!user || !await verifyPassword(currentPassword, user.passwordHash)) throw httpError(401, 'Reauthentication failed.', 'REAUTHENTICATION_FAILED');
  ensureMfaKey();
  const secret = decryptMfaSecret(user.mfaSecretEncrypted, env.MFA_ENCRYPTION_KEY);
  const now = new Date();
  const counter = verifyTotp(secret, code, now.getTime(), Number.isSafeInteger(user.mfaLastCounter) ? user.mfaLastCounter : -1);
  if (counter === null) throw httpError(401, 'Reauthentication failed.', 'REAUTHENTICATION_FAILED');
  const recoveryCodes = createRecoveryCodes();
  const recoveryHashes = [];
  for (const recovery of recoveryCodes) recoveryHashes.push(await hashPassword(normalizeRecoveryCode(recovery)));
  const updated = await User.findOneAndUpdate({ _id: user._id, mfaEnabled: true, mfaLastCounter: user.mfaLastCounter }, {
    $set: { mfaRecoveryCodeHashes: recoveryHashes, mfaLastCounter: counter }
  }, { new: true });
  if (!updated) throw httpError(409, 'Administrator security state changed. Sign in again and retry.', 'ADMIN_SECURITY_STATE_CHANGED');
  await AdminAudit.create({
    actor: user._id,
    action: 'auth.admin.mfa.recovery.rotate',
    reason: 'Administrator reauthenticated and replaced recovery codes.',
    metadata: { codeCount: recoveryCodes.length }
  });
  res.json({ success: true, recoveryCodes });
});

export const beginAdminMfaReplacement = asyncHandler(async (req, res) => {
  preventMfaMaterialCaching(res);
  const currentPassword = String(req.body?.currentPassword || '');
  const code = String(req.body?.code || '').trim();
  const recoveryCode = normalizeRecoveryCode(req.body?.recoveryCode);
  if (!currentPassword || Boolean(code) === Boolean(recoveryCode)) {
    throw httpError(400, 'Enter your current password and exactly one authenticator or recovery code.', 'MFA_REPLACEMENT_PROOF_REQUIRED');
  }

  const user = await User.findById(req.user._id).select('+passwordHash +mfaSecretEncrypted +mfaRecoveryCodeHashes +mfaLastCounter');
  if (!user || !STAFF_ROLES.includes(user.role) || user.status !== 'active' || user.mfaEnabled !== true || !user.mfaSecretEncrypted || !await verifyPassword(currentPassword, user.passwordHash)) {
    throw httpError(401, 'Reauthentication failed.', 'REAUTHENTICATION_FAILED');
  }
  ensureMfaKey();

  const now = new Date();
  const updateFilter = {
    _id: user._id,
    role: { $in: STAFF_ROLES },
    status: 'active',
    mfaEnabled: true,
    mfaSecretEncrypted: user.mfaSecretEncrypted
  };
  const update = { $set: {} };
  let proofMethod;

  if (recoveryCode) {
    let matchedHash = null;
    for (const storedHash of user.mfaRecoveryCodeHashes || []) {
      if (await verifyPassword(recoveryCode, storedHash)) {
        matchedHash = storedHash;
        break;
      }
    }
    if (!matchedHash) throw httpError(401, 'Reauthentication failed.', 'REAUTHENTICATION_FAILED');
    updateFilter.mfaRecoveryCodeHashes = matchedHash;
    update.$pull = { mfaRecoveryCodeHashes: matchedHash };
    proofMethod = 'recovery_code';
  } else {
    const lastCounter = Number.isSafeInteger(user.mfaLastCounter) ? user.mfaLastCounter : -1;
    const acceptedCounter = verifyTotp(decryptMfaSecret(user.mfaSecretEncrypted, env.MFA_ENCRYPTION_KEY), code, now.getTime(), lastCounter);
    if (acceptedCounter === null) throw httpError(401, 'Reauthentication failed.', 'REAUTHENTICATION_FAILED');
    updateFilter.$or = [{ mfaLastCounter: { $lt: acceptedCounter } }, { mfaLastCounter: { $exists: false } }];
    update.$set.mfaLastCounter = acceptedCounter;
    proofMethod = 'totp';
  }

  const replacementSecret = createTotpSecret();
  const challengeId = randomUUID();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  Object.assign(update.$set, {
    mfaReplacementSecretEncrypted: encryptMfaSecret(replacementSecret, env.MFA_ENCRYPTION_KEY),
    mfaReplacementChallengeId: challengeId,
    mfaReplacementExpiresAt: expiresAt,
    mfaReplacementSessionId: req.session._id
  });
  const updated = await User.findOneAndUpdate(updateFilter, update, { new: true });
  if (!updated) throw httpError(409, 'Your security state changed. Sign in again and retry.', 'ADMIN_SECURITY_STATE_CHANGED');

  await AdminAudit.create({
    actor: user._id,
    action: 'auth.admin.mfa.replacement.begin',
    reason: 'Administrator verified existing credentials and began authenticator replacement.',
    metadata: { proofMethod }
  });
  res.status(200).json({
    success: true,
    challengeId,
    expiresAt: expiresAt.toISOString(),
    secret: replacementSecret,
    otpauthUrl: buildTotpUri(user.email, replacementSecret)
  });
});

export const completeAdminMfaReplacement = asyncHandler(async (req, res) => {
  preventMfaMaterialCaching(res);
  const challengeId = String(req.body?.challengeId || '');
  const code = String(req.body?.code || '').trim();
  if (!challengeId || !/^\d{6}$/u.test(code)) {
    throw httpError(400, 'Enter the six-digit code from the replacement authenticator.', 'MFA_REPLACEMENT_INVALID');
  }

  const user = await User.findById(req.user._id).select('+mfaSecretEncrypted +mfaReplacementSecretEncrypted +mfaReplacementChallengeId +mfaReplacementExpiresAt +mfaReplacementSessionId');
  const now = new Date();
  if (!user || !STAFF_ROLES.includes(user.role) || user.status !== 'active' || user.mfaEnabled !== true || user.mfaReplacementChallengeId !== challengeId || user.mfaReplacementSessionId?.toString() !== req.session._id.toString() || !user.mfaReplacementSecretEncrypted || !user.mfaReplacementExpiresAt) {
    throw httpError(401, 'The authenticator replacement is invalid or expired.', 'MFA_REPLACEMENT_INVALID');
  }
  if (user.mfaReplacementExpiresAt <= now) {
    await discardReplacementIfExpired(user._id, challengeId, req.session._id, now);
    throw httpError(410, 'This authenticator setup expired. Your existing authenticator is still active; start again to get a fresh QR code.', 'MFA_REPLACEMENT_EXPIRED');
  }

  const replacementSecret = decryptMfaSecret(user.mfaReplacementSecretEncrypted, env.MFA_ENCRYPTION_KEY);
  const acceptedCounter = verifyTotp(replacementSecret, code, now.getTime(), -1);
  if (acceptedCounter === null) throw httpError(401, 'The replacement authenticator code is invalid.', 'MFA_CODE_INVALID');

  const recoveryCodes = createRecoveryCodes();
  const recoveryHashes = [];
  for (const recovery of recoveryCodes) recoveryHashes.push(await hashPassword(normalizeRecoveryCode(recovery)));
  const activationTime = new Date();
  if (user.mfaReplacementExpiresAt <= activationTime) {
    await discardReplacementIfExpired(user._id, challengeId, req.session._id, activationTime);
    throw httpError(410, 'This authenticator setup expired. Your existing authenticator is still active; start again to get a fresh QR code.', 'MFA_REPLACEMENT_EXPIRED');
  }
  const replaced = await User.findOneAndUpdate({
    _id: user._id,
    role: { $in: STAFF_ROLES },
    status: 'active',
    mfaEnabled: true,
    mfaSecretEncrypted: user.mfaSecretEncrypted,
    mfaReplacementSecretEncrypted: user.mfaReplacementSecretEncrypted,
    mfaReplacementChallengeId: challengeId,
    mfaReplacementSessionId: req.session._id,
    mfaReplacementExpiresAt: { $gt: activationTime }
  }, {
    $set: {
      mfaSecretEncrypted: user.mfaReplacementSecretEncrypted,
      mfaLastCounter: acceptedCounter,
      mfaRecoveryCodeHashes: recoveryHashes
    },
    $unset: {
      mfaReplacementSecretEncrypted: '',
      mfaReplacementChallengeId: '',
      mfaReplacementExpiresAt: '',
      mfaReplacementSessionId: ''
    }
  }, { new: true });
  if (!replaced) throw httpError(409, 'The replacement setup was already used or your security state changed.', 'MFA_REPLACEMENT_INVALID');

  await Session.updateMany({ user: user._id, _id: { $ne: req.session._id }, revokedAt: null }, { $set: { revokedAt: now } });
  await AdminAudit.create({
    actor: user._id,
    action: 'auth.admin.mfa.replacement.completed',
    reason: 'Administrator verified and activated a replacement authenticator.',
    metadata: { recoveryCodeCount: recoveryCodes.length }
  });
  res.status(200).json({ success: true, recoveryCodes });
});

export const reauthenticateAdmin = asyncHandler(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const code = String(req.body?.code || '');
  const user = await User.findById(req.user._id).select('+passwordHash +mfaSecretEncrypted +mfaLastCounter');
  if (!user || !user.mfaEnabled || !user.mfaSecretEncrypted || !await verifyPassword(currentPassword, user.passwordHash)) {
    throw httpError(401, 'Reauthentication failed.', 'REAUTHENTICATION_FAILED');
  }
  ensureMfaKey();
  const now = new Date();
  const lastCounter = Number.isSafeInteger(user.mfaLastCounter) ? user.mfaLastCounter : -1;
  const counter = verifyTotp(decryptMfaSecret(user.mfaSecretEncrypted, env.MFA_ENCRYPTION_KEY), code, now.getTime(), lastCounter);
  if (counter === null) throw httpError(401, 'Reauthentication failed.', 'REAUTHENTICATION_FAILED');
  const updated = await User.findOneAndUpdate({
    _id: user._id,
    mfaEnabled: true,
    $or: [{ mfaLastCounter: { $lt: counter } }, { mfaLastCounter: { $exists: false } }]
  }, { $set: { mfaLastCounter: counter } }, { new: true });
  if (!updated) throw httpError(409, 'Administrator security state changed. Sign in again and retry.', 'ADMIN_SECURITY_STATE_CHANGED');
  const sessionUpdate = await Session.updateOne({ _id: req.session._id, revokedAt: null }, { $set: { mfaReauthenticatedAt: now } });
  if (Number(sessionUpdate.matchedCount ?? sessionUpdate.n ?? 0) !== 1) {
    throw httpError(401, 'The current session is no longer active.', 'SESSION_REVOKED');
  }
  await AdminAudit.create({
    actor: user._id,
    action: 'auth.admin.reauthenticate',
    reason: 'Administrator completed a fresh password and authenticator check.',
    metadata: { purpose: String(req.body?.purpose || 'sensitive_action').slice(0, 80) }
  });
  res.json({ success: true, reauthenticatedAt: now.toISOString(), validForSeconds: 300 });
});

export const revokeOtherAdminSessions = asyncHandler(async (req, res) => {
  const result = await Session.updateMany({
    user: req.user._id,
    _id: { $ne: req.session._id },
    revokedAt: null
  }, { $set: { revokedAt: new Date() } });
  const revokedCount = Number(result.modifiedCount || result.nModified || 0);
  await AdminAudit.create({
    actor: req.user._id,
    action: 'auth.admin.sessions.revoke_others',
    reason: 'Administrator revoked other active sessions after reauthentication.',
    metadata: { revokedCount }
  });
  res.json({ success: true, revokedCount });
});
