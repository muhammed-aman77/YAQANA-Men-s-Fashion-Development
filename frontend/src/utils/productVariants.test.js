import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVariantMatrix, getColourGallery, getProductVariant, getVariantStock } from './productVariants.js';
import { formatInr } from './currency.js';

const product = {
  stock: 12,
  images: ['/uploads/default.jpg'],
  colours: [
    { name: 'Black', images: ['/uploads/black-front.jpg', '/uploads/black-back.jpg'] },
    { name: 'Stone', images: [] }
  ],
  variants: [
    { size: 'S', colour: 'Black', sku: 'YAQ-TEE-BLK-S', stock: 0 },
    { size: 'M', colour: 'Black', sku: 'YAQ-TEE-BLK-M', stock: 7 }
  ]
};

test('a configured zero-stock variant does not fall back to aggregate stock', () => {
  assert.equal(getVariantStock(product, 'S', 'Black'), 0);
  assert.equal(getProductVariant(product, 'S', 'black').sku, 'YAQ-TEE-BLK-S');
});

test('legacy products continue to use aggregate stock and the global image gallery', () => {
  const legacyProduct = { stock: 9, images: ['/uploads/legacy.jpg'], colours: [{ name: 'Black' }] };
  assert.equal(getVariantStock(legacyProduct, 'S', 'Black'), 9);
  assert.deepEqual(getColourGallery(legacyProduct, 'Black'), ['/uploads/legacy.jpg']);
});

test('a colour uses its own gallery when one is configured', () => {
  assert.deepEqual(getColourGallery(product, 'Black'), ['/uploads/black-front.jpg', '/uploads/black-back.jpg']);
});

test('variant availability subtracts reserved stock and fails closed on invalid counters', async () => {
  const { getVariantAvailability, getVariantStatus } = await import('./productVariants.js');
  assert.equal(typeof getVariantAvailability, 'function');
  assert.equal(getVariantAvailability({
    variants: [{ size: 'M', colour: 'Black', stock: 5, reservedQuantity: 2 }]
  }, 'M', 'Black'), 3);
  assert.equal(getVariantAvailability({
    variants: [{ size: 'M', colour: 'Black', stock: 5, reservedQuantity: 6 }]
  }, 'M', 'Black'), 0);
  assert.equal(getVariantStatus(product, 'S', 'Black'), 'active');
  assert.equal(getVariantStatus({
    variants: [{ size: 'M', colour: 'Black', status: 'discontinued' }]
  }, 'M', 'Black'), 'discontinued');
});

test('variant imagery takes precedence over colour and product galleries', async () => {
  const { getVariantImages } = await import('./productVariants.js');
  assert.equal(typeof getVariantImages, 'function');
  assert.deepEqual(getVariantImages({
    ...product,
    variants: [{ size: 'M', colour: 'Black', images: ['/uploads/sku-front.jpg'] }]
  }, 'M', 'Black'), ['/uploads/sku-front.jpg']);
  assert.deepEqual(getVariantImages(product, 'M', 'Black'), [
    '/uploads/black-front.jpg',
    '/uploads/black-back.jpg'
  ]);
  assert.deepEqual(getVariantImages({
    images: ['/uploads/product-front.jpg'],
    colours: [{ name: 'Stone', images: [] }]
  }, 'M', 'Stone'), ['/uploads/product-front.jpg']);
});

test('variant price resolution uses the variant sale and regular prices before product prices', async () => {
  const { getVariantPrice } = await import('./productVariants.js');
  assert.equal(typeof getVariantPrice, 'function');
  const price = getVariantPrice({
    price: 100,
    discountPrice: 90,
    variants: [{
      size: 'M',
      colour: 'Black',
      pricePaise: 399000,
      discountPricePaise: 350000
    }]
  }, 'M', 'Black');

  assert.equal(formatInr(price.price), '₹3,500');
  assert.equal(formatInr(price.originalPrice), '₹3,990');
});

test('SKU matrix generation covers every combination and starts new stock at zero', () => {
  let suffix = 0;
  const matrix = buildVariantMatrix({
    productName: 'Core Tee',
    sizes: ['S', 'M'],
    colours: ['Black', 'Stone'],
    createSuffix: () => String(++suffix).padStart(8, '0')
  });

  assert.deepEqual(matrix, [
    { size: 'S', colour: 'Black', sku: 'YQ-CORE-TEE-BLACK-S-00000001', stock: 0 },
    { size: 'S', colour: 'Stone', sku: 'YQ-CORE-TEE-STONE-S-00000002', stock: 0 },
    { size: 'M', colour: 'Black', sku: 'YQ-CORE-TEE-BLACK-M-00000003', stock: 0 },
    { size: 'M', colour: 'Stone', sku: 'YQ-CORE-TEE-STONE-M-00000004', stock: 0 }
  ]);
});

test('SKU matrix regeneration preserves optional metadata for unchanged combinations', () => {
  const existingVariant = {
    size: 'S',
    colour: 'Black',
    sku: 'YAQ-TEE-BLK-S',
    stock: 6,
    barcode: '0123456789',
    pricePaise: 399000,
    status: 'inactive',
    images: ['/uploads/black-s.jpg']
  };
  const matrix = buildVariantMatrix({
    productName: 'Core Tee',
    sizes: ['S', 'M'],
    colours: ['Black'],
    existingVariants: [existingVariant],
    createSuffix: () => '00000001'
  });

  assert.deepEqual(matrix[0], existingVariant);
  assert.equal(matrix[1].stock, 0);
});

test('SKU matrix regeneration preserves existing stock and SKU for unchanged combinations', () => {
  const matrix = buildVariantMatrix({
    productName: 'Core Tee',
    sizes: ['S', 'M'],
    colours: ['Black'],
    existingVariants: [{ size: 'S', colour: 'Black', sku: 'YAQ-TEE-BLK-S', stock: 6 }],
    createSuffix: () => '00000001'
  });

  assert.deepEqual(matrix, [
    { size: 'S', colour: 'Black', sku: 'YAQ-TEE-BLK-S', stock: 6 },
    { size: 'M', colour: 'Black', sku: 'YQ-CORE-TEE-BLACK-M-00000001', stock: 0 }
  ]);
});
