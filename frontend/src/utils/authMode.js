export const CSRF_COOKIE_NAME = 'yaqana_csrf';

export const isCookieAuthMode = (mode) => mode === 'cookie';

export const AUTH_MODE = isCookieAuthMode(import.meta.env?.VITE_AUTH_MODE) ? 'cookie' : 'bearer';

export function readCookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== 'string' || typeof name !== 'string' || !name) return null;
  for (const part of cookieHeader.split(';')) {
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
