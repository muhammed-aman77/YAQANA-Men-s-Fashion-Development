import test from 'node:test';
import assert from 'node:assert/strict';

const pricing = {
  paisePerCatalogUnit: 8300,
  shippingThreshold: 200,
  shippingFee: 15,
  taxRate: 0.08
};

const productId = '64b000000000000000000001';
const product = {
  _id: productId,
  name: 'YAQANA Mock Tee',
  category: 'T-Shirts',
  gender: 'men',
  active: true,
  pricePaise: 830000,
  discountPricePaise: 747000,
  sizes: ['M'],
  colours: [{ name: 'Sand', images: ['/images/sand-tee.jpg'] }],
  variants: [{ size: 'M', colour: 'Sand', sku: 'YAQ-TEE-SND-M', stock: 4 }],
  images: ['/images/tee.jpg'],
  stock: 4
};

async function loadQuoteBuilder() {
  const module = await import('../src/utils/checkoutQuote.js').catch(() => null);
  assert.ok(module, 'checkoutQuote.js should be implemented');
  assert.equal(typeof module.buildCheckoutQuote, 'function', 'buildCheckoutQuote should be exported');
  return module.buildCheckoutQuote;
}

test('quote uses current product prices and applies product discounts', async () => {
  const buildCheckoutQuote = await loadQuoteBuilder();
  const quote = buildCheckoutQuote([
    { productId, quantity: 2, size: 'M', colour: 'Sand' }
  ], [product], pricing);

  assert.equal(quote.originalSubtotalPaise, 1660000);
  assert.equal(quote.discountPaise, 166000);
  assert.equal(quote.subtotalPaise, 1494000);
  assert.equal(quote.lines[0].pricePaise, 747000);
  assert.equal(quote.lines[0].originalPricePaise, 830000);
});

test('quote resolves variant pricing before product pricing', async () => {
  const buildCheckoutQuote = await loadQuoteBuilder();
  const variantPricedProduct = {
    ...product,
    variants: [{
      ...product.variants[0],
      pricePaise: 399000,
      discountPricePaise: 350000
    }]
  };
  const variantQuote = buildCheckoutQuote([
    { productId, quantity: 1, size: 'M', colour: 'Sand' }
  ], [variantPricedProduct], pricing);
  assert.equal(variantQuote.lines[0].pricePaise, 350000);
  assert.equal(variantQuote.lines[0].originalPricePaise, 399000);

  const variantRegularPriceOnly = {
    ...product,
    variants: [{ ...product.variants[0], pricePaise: 399000 }]
  };
  const regularQuote = buildCheckoutQuote([
    { productId, quantity: 1, size: 'M', colour: 'Sand' }
  ], [variantRegularPriceOnly], pricing);
  assert.equal(regularQuote.lines[0].pricePaise, 399000);
  assert.equal(regularQuote.lines[0].originalPricePaise, 399000);
});

test('quote preserves selected variant SKU, availability, and quantity', async () => {
  const buildCheckoutQuote = await loadQuoteBuilder();
  const quote = buildCheckoutQuote([
    { productId, quantity: 3, size: 'M', colour: 'Sand' }
  ], [product], pricing);

  assert.deepEqual(quote.lines[0], {
    productId,
    sku: 'YAQ-TEE-SND-M',
    name: 'YAQANA Mock Tee',
    image: '/images/sand-tee.jpg',
    category: 'T-Shirts',
    pricePaise: 747000,
    originalPricePaise: 830000,
    quantity: 3,
    size: 'M',
    colour: 'Sand',
    availableStock: 4
  });
});

test('quote rejects missing products, invalid variants, and quantities above stock', async () => {
  const buildCheckoutQuote = await loadQuoteBuilder();
  const item = { productId, quantity: 1, size: 'M', colour: 'Sand' };

  assert.throws(
    () => buildCheckoutQuote([item], [], pricing),
    (error) => error.statusCode === 404
  );
  const incompleteVariantProduct = {
    ...product,
    colours: [...product.colours, { name: 'Black', images: [] }]
  };
  assert.throws(
    () => buildCheckoutQuote([{ ...item, colour: 'Black' }], [incompleteVariantProduct], pricing),
    (error) => error.statusCode === 409
  );
  assert.throws(
    () => buildCheckoutQuote([{ ...item, quantity: 5 }], [product], pricing),
    (error) => error.statusCode === 409
  );
  assert.throws(
    () => buildCheckoutQuote([{ ...item, quantity: 21 }], [product], pricing),
    (error) => error.statusCode === 400
  );
});

test('quote rejects inactive and discontinued variants even when stock remains', async () => {
  const buildCheckoutQuote = await loadQuoteBuilder();
  for (const status of ['inactive', 'discontinued']) {
    assert.throws(
      () => buildCheckoutQuote([
        { productId, quantity: 1, size: 'M', colour: 'Sand' }
      ], [{
        ...product,
        variants: [{ ...product.variants[0], stock: 4, status }]
      }], pricing),
      (error) => error.statusCode === 409
    );
  }
});

test('quote subtracts reserved units once from physical stock', async () => {
  const buildCheckoutQuote = await loadQuoteBuilder();
  const reservedProduct = {
    ...product,
    variants: [{ ...product.variants[0], stock: 5, reservedQuantity: 2 }]
  };

  const quote = buildCheckoutQuote([
    { productId, quantity: 3, size: 'M', colour: 'Sand' }
  ], [reservedProduct], pricing);
  assert.equal(quote.lines[0].availableStock, 3);
  assert.throws(
    () => buildCheckoutQuote([
      { productId, quantity: 4, size: 'M', colour: 'Sand' }
    ], [reservedProduct], pricing),
    (error) => error.statusCode === 409
  );
});

test('quote prefers variant imagery before colour and product galleries', async () => {
  const buildCheckoutQuote = await loadQuoteBuilder();
  const variantImageProduct = {
    ...product,
    variants: [{ ...product.variants[0], images: ['/images/sand-medium.jpg'] }]
  };
  const quote = buildCheckoutQuote([
    { productId, quantity: 1, size: 'M', colour: 'Sand' }
  ], [variantImageProduct], pricing);

  assert.equal(quote.lines[0].image, '/images/sand-medium.jpg');
});

test('quote applies existing shipping and tax settings using integer paise', async () => {
  const buildCheckoutQuote = await loadQuoteBuilder();
  const quote = buildCheckoutQuote([
    { productId, quantity: 2, size: 'M', colour: 'Sand' }
  ], [product], pricing);

  assert.equal(quote.shippingFeePaise, 124500);
  assert.equal(quote.taxPaise, 119520);
  assert.equal(quote.totalPaise, 1738020);

  const fullPriceProduct = { ...product, discountPricePaise: null };
  const freeShippingQuote = buildCheckoutQuote([
    { productId, quantity: 3, size: 'M', colour: 'Sand' }
  ], [fullPriceProduct], pricing);
  assert.equal(freeShippingQuote.shippingFeePaise, 0);
});

test('quote comparison rejects changed prices or availability', async () => {
  const module = await import('../src/utils/checkoutQuote.js');
  assert.equal(typeof module.assertCheckoutQuoteMatches, 'function', 'assertCheckoutQuoteMatches should be exported');
  const buildCheckoutQuote = module.buildCheckoutQuote;
  const quoted = buildCheckoutQuote([
    { productId, quantity: 2, size: 'M', colour: 'Sand' }
  ], [product], pricing);
  const current = buildCheckoutQuote([
    { productId, quantity: 2, size: 'M', colour: 'Sand' }
  ], [{ ...product, discountPricePaise: 700000 }], pricing);

  assert.throws(
    () => module.assertCheckoutQuoteMatches(quoted, current),
    (error) => error.statusCode === 409 && error.code === 'PRICE_OR_AVAILABILITY_CHANGED'
  );
  assert.throws(
    () => module.assertCheckoutQuoteMatches(quoted, {
      ...quoted,
      lines: quoted.lines.map((line) => ({ ...line, availableStock: line.availableStock - 1 }))
    }),
    (error) => error.code === 'PRICE_OR_AVAILABILITY_CHANGED'
  );
  assert.doesNotThrow(() => module.assertCheckoutQuoteMatches(quoted, quoted));
});

test('quote validates product IDs and quantities before database lookup', async () => {
  const module = await import('../src/utils/checkoutQuote.js');
  assert.equal(typeof module.getCheckoutProductIds, 'function', 'getCheckoutProductIds should be exported');

  assert.deepEqual(module.getCheckoutProductIds([
    { productId, quantity: 2, size: 'M', colour: 'Sand' }
  ]), [productId]);
  assert.throws(() => module.getCheckoutProductIds([]), (error) => error.statusCode === 400);
  assert.throws(
    () => module.getCheckoutProductIds([{ productId: 'invalid-id', quantity: 1 }]),
    (error) => error.statusCode === 400
  );
  assert.throws(
    () => module.getCheckoutProductIds([{ productId, quantity: 21 }]),
    (error) => error.statusCode === 400
  );
});

test('quote rejects duplicate variant lines whose combined quantity exceeds stock', async () => {
  const buildCheckoutQuote = await loadQuoteBuilder();

  assert.throws(
    () => buildCheckoutQuote([
      { productId, quantity: 3, size: 'M', colour: 'Sand' },
      { productId, quantity: 2, size: 'M', colour: 'Sand' }
    ], [product], pricing),
    (error) => error.statusCode === 409
  );
});
