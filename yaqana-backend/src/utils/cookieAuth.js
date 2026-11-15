import { createHash, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'yaqana_session';
export const CSRF_COOKIE_NAME = 'yaqana_csrf';

export function getCookieValue(header, name) {
  if (typeof header !== 'string' || typeof name !== 'string' || !name) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function createCsrfTokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function verifyCsrfToken(expectedHash, cookieToken, headerToken) {
  if (typeof expectedHash !== 'string' ||
      typeof cookieToken !== 'string' ||
      !cookieToken ||
      typeof headerToken !== 'string' ||
      cookieToken !== headerToken) {
    return false;
  }
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(createCsrfTokenHash(cookieToken), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionCookieOptions({ production, maxAgeMs }) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs
  };
}

export function createCsrfCookieOptions({ production, maxAgeMs }) {
  return {
    httpOnly: false,
    secure: production,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs
  };
}

export function clearCookieOptions({ production }) {
  return {
    secure: production,
    sameSite: 'lax',
    path: '/'
  };
}
