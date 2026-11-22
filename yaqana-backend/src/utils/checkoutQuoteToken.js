import { createHmac, timingSafeEqual } from 'node:crypto';
import { httpError } from './http.js';

const QUOTE_TTL_MS = 10 * 60 * 1000;

function invalidQuote() {
  return httpError(409, 'Your checkout quote is invalid or has expired. Review your order again.', 'INVALID_CHECKOUT_QUOTE');
}

function asTimestamp(value) {
  const timestamp = value instanceof Date ? value.getTime() : Number.NaN;
  if (!Number.isSafeInteger(timestamp)) throw new TypeError('A valid quote timestamp is required.');
  return timestamp;
}

function signatureFor(payload, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new TypeError('A checkout quote signing secret is required.');
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signCheckoutQuote(quote, userId, secret, now = new Date()) {
  const issuedAt = asTimestamp(now);
  if (!quote || typeof quote !== 'object' || !Array.isArray(quote.lines) || !userId) {
    throw new TypeError('A quote, customer, and timestamp are required.');
  }

  const payload = Buffer.from(JSON.stringify({
    version: 1,
    userId: String(userId),
    issuedAt,
    expiresAt: issuedAt + QUOTE_TTL_MS,
    quote
  })).toString('base64url');
  return `${payload}.${signatureFor(payload, secret)}`;
}

export function verifyCheckoutQuote(token, userId, secret, now = new Date()) {
  const nowTimestamp = asTimestamp(now);
  if (typeof token !== 'string' || typeof userId !== 'string' || !userId) throw invalidQuote();

  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    throw invalidQuote();
  }

  let expectedSignature;
  try {
    expectedSignature = Buffer.from(signatureFor(parts[0], secret), 'base64url');
  } catch {
    throw invalidQuote();
  }
  const suppliedSignature = Buffer.from(parts[1], 'base64url');
  if (expectedSignature.length !== suppliedSignature.length || !timingSafeEqual(expectedSignature, suppliedSignature)) {
    throw invalidQuote();
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    throw invalidQuote();
  }

  if (
    payload?.version !== 1 ||
    payload.userId !== userId ||
    !Number.isSafeInteger(payload.issuedAt) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.issuedAt > nowTimestamp ||
    payload.expiresAt - payload.issuedAt !== QUOTE_TTL_MS ||
    payload.expiresAt <= nowTimestamp ||
    !payload.quote ||
    !Array.isArray(payload.quote.lines)
  ) {
    throw invalidQuote();
  }

  return payload.quote;
}
