import test from 'node:test';
import assert from 'node:assert/strict';

const secret = 'checkout-quote-test-secret-that-is-not-a-credential';
const issuedAt = new Date('2026-11-16T12:00:00.000Z');
const quote = {
  lines: [{
    productId: '64b000000000000000000001',
    sku: 'YAQ-TEE-SND-M',
    quantity: 2,
    size: 'M',
    colour: 'Sand',
    pricePaise: 747000
  }],
  subtotalPaise: 1494000,
  shippingFeePaise: 124500,
  taxPaise: 119520,
  totalPaise: 1838020
};

async function loadQuoteTokenHelpers() {
  const module = await import('../src/utils/checkoutQuoteToken.js').catch(() => null);
  assert.ok(module, 'checkoutQuoteToken.js should be implemented');
  assert.equal(typeof module.signCheckoutQuote, 'function', 'signCheckoutQuote should be exported');
  assert.equal(typeof module.verifyCheckoutQuote, 'function', 'verifyCheckoutQuote should be exported');
  return module;
}

test('quote token is bound to the customer and expires after ten minutes', async () => {
  const { signCheckoutQuote, verifyCheckoutQuote } = await loadQuoteTokenHelpers();
  const token = signCheckoutQuote(quote, 'customer-1', secret, issuedAt);

  assert.deepEqual(
    verifyCheckoutQuote(token, 'customer-1', secret, new Date(issuedAt.getTime() + 599999)),
    quote
  );
  assert.throws(
    () => verifyCheckoutQuote(token, 'customer-2', secret, issuedAt),
    (error) => error.code === 'INVALID_CHECKOUT_QUOTE'
  );
  assert.throws(
    () => verifyCheckoutQuote(token, 'customer-1', secret, new Date(issuedAt.getTime() + 600001)),
    (error) => error.code === 'INVALID_CHECKOUT_QUOTE'
  );
});

test('quote token rejects tampering and malformed values', async () => {
  const { signCheckoutQuote, verifyCheckoutQuote } = await loadQuoteTokenHelpers();
  const token = signCheckoutQuote(quote, 'customer-1', secret, issuedAt);
  const replacement = token.endsWith('A') ? 'B' : 'A';
  const tampered = `${token.slice(0, -1)}${replacement}`;

  assert.throws(
    () => verifyCheckoutQuote(tampered, 'customer-1', secret, issuedAt),
    (error) => error.code === 'INVALID_CHECKOUT_QUOTE'
  );
  assert.throws(
    () => verifyCheckoutQuote('not-a-valid-token', 'customer-1', secret, issuedAt),
    (error) => error.code === 'INVALID_CHECKOUT_QUOTE'
  );
});
