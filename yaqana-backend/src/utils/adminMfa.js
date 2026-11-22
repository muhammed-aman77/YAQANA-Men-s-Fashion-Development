import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;

function decodeBase32(value) {
  const input = String(value || '').toUpperCase().replace(/=+$/u, '').replace(/\s+/gu, '');
  if (!/^[A-Z2-7]+$/u.test(input)) throw new Error('Invalid TOTP secret.');
  let bits = '';
  for (const character of input) bits += BASE32_ALPHABET.indexOf(character).toString(2).padStart(5, '0');
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function parseEncryptionKey(encodedKey) {
  if (typeof encodedKey !== 'string') throw new Error('MFA_ENCRYPTION_KEY must be configured before administrator MFA can be used.');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/u, '') !== encodedKey.replace(/=+$/u, '')) {
    throw new Error('MFA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

export function createTotpSecret() {
  const bytes = randomBytes(20);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let offset = 0; offset < bits.length; offset += 5) result += BASE32_ALPHABET[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, '0'), 2)];
  return result;
}

export function buildTotpUri(email, secret) {
  const issuer = 'YAQANA';
  const label = `YAQANA Admin:${String(email || '').trim().toLowerCase()}`;
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function createTotpCode(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret, code, timestamp = Date.now(), lastCounter = -1, window = 1) {
  if (!/^\d{6}$/u.test(String(code || '')) || !Number.isSafeInteger(lastCounter) || !Number.isInteger(window) || window < 0 || window > 2) return null;
  const currentCounter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
  for (let drift = -window; drift <= window; drift += 1) {
    const counter = currentCounter + drift;
    if (counter <= lastCounter || counter < 0) continue;
    if (createTotpCode(secret, counter * TOTP_PERIOD_SECONDS * 1000) === code) return counter;
  }
  return null;
}

export function encryptMfaSecret(secret, encodedKey) {
  const key = parseEncryptionKey(encodedKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptMfaSecret(encrypted, encodedKey) {
  const [version, ivValue, tagValue, ciphertextValue, ...extra] = String(encrypted || '').split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue || extra.length) throw new Error('Stored administrator MFA secret is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', parseEncryptionKey(encodedKey), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
}

export function createRecoveryCodes(count = 10) {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('Recovery code count must be between 1 and 20.');
  return Array.from({ length: count }, () => randomBytes(18).toString('base64url'));
}

export function normalizeRecoveryCode(code) {
  return String(code || '').trim().replace(/[\s-]/gu, '').toLowerCase();
}
