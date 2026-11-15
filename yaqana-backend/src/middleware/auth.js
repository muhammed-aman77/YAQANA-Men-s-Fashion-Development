import User from '../models/User.js';
import Session from '../models/Session.js';
import { env } from '../config/env.js';
import {
  clearCookieOptions,
  CSRF_COOKIE_NAME,
  getCookieValue,
  SESSION_COOKIE_NAME,
  verifyCsrfToken
} from '../utils/cookieAuth.js';
import { verifyToken } from '../utils/token.js';
import { asyncHandler, httpError } from '../utils/http.js';

function bearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

function clearAuthCookies(res) {
  const options = clearCookieOptions({ production: env.NODE_ENV === 'production' });
  res.clearCookie(SESSION_COOKIE_NAME, options);
  res.clearCookie(CSRF_COOKIE_NAME, options);
}

export const optionalAuth = asyncHandler(async (req, res, next) => {
  const cookieToken = env.AUTH_COOKIE_ENABLED
    ? getCookieValue(req.headers.cookie, SESSION_COOKIE_NAME)
    : null;
  const token = cookieToken || bearer(req);
  if (!token) return next();
  const payload = verifyToken(token);
  if (!payload) {
    if (cookieToken) clearAuthCookies(res);
    throw httpError(401, 'Your session is invalid or has expired.', 'INVALID_SESSION');
  }
  const session = await Session.findOne({
    jti: payload.jti,
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  }).select('+csrfTokenHash');
  if (!session) {
    if (cookieToken) clearAuthCookies(res);
    throw httpError(401, 'Your session is no longer active. Please sign in again.', 'SESSION_REVOKED');
  }
  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') {
    if (cookieToken) clearAuthCookies(res);
    throw httpError(401, 'Your account is unavailable.', 'ACCOUNT_UNAVAILABLE');
  }
  req.user = user;
  req.session = session;
  req.authSource = cookieToken ? 'cookie' : 'bearer';
  req.tokenPayload = payload;
  next();
});

export function requireCsrfForCookieAuth(req, _res, next) {
  if (req.authSource !== 'cookie' || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const csrfCookie = getCookieValue(req.headers.cookie, CSRF_COOKIE_NAME);
  const csrfHeader = req.headers['x-yaqana-csrf-token'];
  if (!verifyCsrfToken(req.session?.csrfTokenHash, csrfCookie, csrfHeader)) {
    return next(httpError(403, 'A valid CSRF token is required.', 'CSRF_VALIDATION_FAILED'));
  }
  next();
}

export const requireAuth = [optionalAuth, requireCsrfForCookieAuth, (req, _res, next) => {
  if (!req.user) return next(httpError(401, 'Please sign in to continue.', 'AUTHENTICATION_REQUIRED'));
  next();
}];

export const requireAdmin = (req, _res, next) => {
  if (req.user?.role !== 'admin') return next(httpError(403, 'Administrator access is required.', 'ADMIN_REQUIRED'));
  next();
};
