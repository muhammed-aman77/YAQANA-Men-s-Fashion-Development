import { randomBytes } from 'node:crypto';
import User from '../models/User.js';
import Session from '../models/Session.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { issueToken } from '../utils/token.js';
import { env } from '../config/env.js';
import { setAdminReportingTimeZone } from '../utils/adminPreferences.js';
import {
  clearCookieOptions,
  createCsrfCookieOptions,
  createCsrfTokenHash,
  createSessionCookieOptions,
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME
} from '../utils/cookieAuth.js';
import { asyncHandler, httpError } from '../utils/http.js';
import { toPublicUser } from '../utils/publicUser.js';

export async function createSession(user, res, { mfaVerified = false } = {}) {
  const issued = issueToken(user._id);
  const maxAgeMs = env.JWT_TTL_SECONDS * 1000;
  const csrfToken = env.AUTH_COOKIE_ENABLED ? randomBytes(32).toString('base64url') : null;
  await Session.create({
    user: user._id,
    jti: issued.jti,
    expiresAt: issued.expiresAt,
    csrfTokenHash: csrfToken ? createCsrfTokenHash(csrfToken) : null,
    mfaVerifiedAt: mfaVerified ? new Date() : null
  });
  if (env.AUTH_COOKIE_ENABLED) {
    res.cookie(SESSION_COOKIE_NAME, issued.token, createSessionCookieOptions({
      production: env.NODE_ENV === 'production',
      maxAgeMs
    }));
    res.cookie(CSRF_COOKIE_NAME, csrfToken, createCsrfCookieOptions({
      production: env.NODE_ENV === 'production',
      maxAgeMs
    }));
    return { success: true, authMode: 'cookie', user: { ...toPublicUser(user), adminMfaVerified: mfaVerified } };
  }
  return { success: true, authMode: 'bearer', token: issued.token, user: { ...toPublicUser(user), adminMfaVerified: mfaVerified } };
}

export const register = asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const confirmPassword = String(req.body?.confirmPassword || '');
  if (name.length < 2 || name.length > 100) throw httpError(400, 'Please enter a valid name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw httpError(400, 'Please enter a valid email address.');
  if (password.length < 8 || password.length > 128) throw httpError(400, 'Password must contain at least 8 characters.');
  if (confirmPassword && password !== confirmPassword) throw httpError(400, 'Passwords do not match.');
  if (await User.exists({ email })) throw httpError(409, 'An account with this email already exists.', 'EMAIL_ALREADY_REGISTERED');
  const user = await User.create({ name, email, passwordHash: await hashPassword(password), role: 'customer' });
  res.status(201).json(await createSession(user, res));
});

export const login = asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw httpError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
  if (user.status !== 'active') throw httpError(403, 'This account is currently unavailable.', 'ACCOUNT_BLOCKED');
  if (user.role !== 'customer') {
    throw httpError(403, 'Administrator accounts must use the separate administrator sign-in.', 'ADMIN_SIGN_IN_REQUIRED');
  }
  res.status(200).json(await createSession(user, res));
});

export const getProfile = asyncHandler(async (req, res) => res.json({ success: true, user: {
  ...toPublicUser(req.user),
  adminMfaVerified: ['support_agent', 'admin', 'owner'].includes(req.user.role) && Boolean(req.session?.mfaVerifiedAt)
} }));

export const updateProfile = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { name, phone } = body;
  if (Object.hasOwn(body, 'reportingTimeZone')) {
    setAdminReportingTimeZone(req.user, body.reportingTimeZone);
  }
  if (name !== undefined) {
    const value = String(name).trim();
    if (value.length < 2 || value.length > 100) throw httpError(400, 'Name must be between 2 and 100 characters.');
    req.user.name = value;
  }
  if (phone !== undefined) {
    const value = String(phone).trim();
    if (value.length > 25) throw httpError(400, 'Phone number is invalid.');
    req.user.phone = value;
  }
  await req.user.save();
  res.json({ success: true, message: 'Profile updated successfully.', user: toPublicUser(req.user) });
});

export const changePassword = asyncHandler(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || req.body?.oldPassword || '');
  const newPassword = String(req.body?.newPassword || req.body?.password || '');
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!await verifyPassword(currentPassword, user.passwordHash)) throw httpError(400, 'Current password is incorrect.', 'CURRENT_PASSWORD_INCORRECT');
  if (newPassword.length < 8 || newPassword.length > 128) throw httpError(400, 'New password must contain at least 8 characters.');
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  await Session.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  clearAuthCookies(res);
  res.json({ success: true, message: 'Password changed. Please sign in again.' });
});

export const logout = asyncHandler(async (req, res) => {
  if (req.session) await Session.updateOne({ _id: req.session._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  clearAuthCookies(res);
  res.json({ success: true, message: 'Logged out successfully.' });
});

function clearAuthCookies(res) {
  const options = clearCookieOptions({ production: env.NODE_ENV === 'production' });
  res.clearCookie(SESSION_COOKIE_NAME, options);
  res.clearCookie(CSRF_COOKIE_NAME, options);
}
