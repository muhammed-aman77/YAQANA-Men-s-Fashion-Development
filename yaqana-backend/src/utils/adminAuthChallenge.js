import { createHmac, timingSafeEqual } from 'node:crypto';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (value, secret) => createHmac('sha256', secret).update(value).digest('base64url');

export function issueAdminAuthChallenge({ userId, challengeId, purpose, secret, now = Date.now(), ttlSeconds = 300 }) {
  if (!userId || !challengeId || !['mfa', 'enrollment'].includes(purpose) || typeof secret !== 'string' || secret.length < 32) {
    throw new Error('A valid administrator challenge configuration is required.');
  }
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: 'yaqana-admin-auth', aud: 'yaqana-admin', sub: String(userId), challengeId: String(challengeId), purpose, iat: Math.floor(now / 1000), exp })}`;
  return { token: `${unsigned}.${sign(unsigned, secret)}`, expiresAt: exp };
}

export function verifyAdminAuthChallenge(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.length < 32) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(unsigned, secret));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (header.alg !== 'HS256' || payload.iss !== 'yaqana-admin-auth' || payload.aud !== 'yaqana-admin' || !payload.sub || !payload.challengeId || !['mfa', 'enrollment'].includes(payload.purpose) || !Number.isSafeInteger(payload.exp) || payload.exp <= now / 1000) return null;
    return { sub: payload.sub, challengeId: payload.challengeId, purpose: payload.purpose, exp: payload.exp };
  } catch {
    return null;
  }
}
