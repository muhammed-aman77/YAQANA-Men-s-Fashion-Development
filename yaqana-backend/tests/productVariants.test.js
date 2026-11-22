import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../src/models/Product.js';
import { assertVariantInventoryUnchanged, findProductVariant, validateVariantMatrix } from '../src/utils/productVariants.js';
import { buildStockMovementChange, buildVariantStockAdjustment } from '../src/utils/variantInventory.js';

const sizes = ['S', 'M'];
const colours = [{ name: 'Black' }, { name: 'Stone' }];

test('validates a complete size and colour matrix while normalizing SKUs', () => {
  const variants = validateVariantMatrix(sizes, colours, [
    { size: 'S', colour: 'Black', sku: 'yaq-tee-blk-s', stock: 4 },
    { size: 'S', colour: 'Stone', sku: 'YAQ-TEE-STN-S', stock: 2 },
    { size: 'M', colour: 'Black', sku: 'YAQ-TEE-BLK-M', stock: 0 },
    { size: 'M', colour: 'Stone', sku: 'YAQ-TEE-STN-M', stock: 7 }
  ]);

  assert.deepEqual(variants, [
    { size: 'S', colour: 'Black', sku: 'YAQ-TEE-BLK-S', stock: 4, status: 'active' },
    { size: 'S', colour: 'Stone', sku: 'YAQ-TEE-STN-S', stock: 2, status: 'active' },
    { size: 'M', colour: 'Black', sku: 'YAQ-TEE-BLK-M', stock: 0, status: 'active' },
    { size: 'M', colour: 'Stone', sku: 'YAQ-TEE-STN-M', stock: 7, status: 'active' }
  ]);
});

test('variant selection matches the configured size and colour without a legacy-stock fallback', () => {
  const product = { variants: [{ size: 'M', colour: 'Black', sku: 'YAQ-TEE-BLK-M', stock: 3 }] };
  assert.equal(findProductVariant(product, 'm', 'black').sku, 'YAQ-TEE-BLK-M');
  assert.equal(findProductVariant(product, 'S', 'Black'), null);
  assert.equal(findProductVariant({ stock: 9 }, 'M', 'Black'), null);
});

test('rejects a partial matrix instead of silently omitting size and colour combinations', () => {
  assert.throws(
    () => validateVariantMatrix(sizes, colours, [
      { size: 'S', colour: 'Black', sku: 'YAQ-TEE-BLK-S', stock: 4 }
    ]),
    /complete size and colour matrix/
  );
});

test('rejects duplicate SKUs and invalid per-variant stock', () => {
  assert.throws(
    () => validateVariantMatrix(['S', 'M'], [{ name: 'Black' }], [
      { size: 'S', colour: 'Black', sku: 'YAQ-TEE-BLK-S', stock: 4 },
      { size: 'M', colour: 'Black', sku: 'yaq-tee-blk-s', stock: 2 }
    ]),
    /unique/
  );
  assert.throws(
    () => validateVariantMatrix(['S'], [{ name: 'Black' }], [
      { size: 'S', colour: 'Black', sku: 'YAQ-TEE-BLK-S', stock: 1.5 }
    ]),
    /whole number/
  );
});

test('normalizes manual SKUs and barcodes while validating optional variant commerce fields', () => {
  const [variant] = validateVariantMatrix(['M'], [{ name: 'Sand' }], [{
    size: 'M',
    colour: 'Sand',
    sku: ' custom-sand-m ',
    stock: 0,
    barcode: ' 0123abc ',
    pricePaise: 399000,
    discountPricePaise: 350000,
    images: ['https://images.example.test/sand-m.jpg', '/uploads/sand-m-back.jpg'],
    status: 'inactive'
  }]);

  assert.deepEqual(variant, {
    size: 'M',
    colour: 'Sand',
    sku: 'CUSTOM-SAND-M',
    stock: 0,
    barcode: '0123ABC',
    pricePaise: 399000,
    discountPricePaise: 350000,
    images: ['https://images.example.test/sand-m.jpg', '/uploads/sand-m-back.jpg'],
    status: 'inactive'
  });
});

test('rejects duplicate normalized barcodes, invalid lifecycle status, and unsafe variant images', () => {
  assert.throws(
    () => validateVariantMatrix(['S', 'M'], [{ name: 'Black' }], [
      { size: 'S', colour: 'Black', sku: 'YAQ-BLK-S', stock: 0, barcode: '012345' },
      { size: 'M', colour: 'Black', sku: 'YAQ-BLK-M', stock: 0, barcode: ' 012345 ' }
    ]),
    /barcodes must be unique/i
  );
  assert.throws(
    () => validateVariantMatrix(['S'], [{ name: 'Black' }], [
      { size: 'S', colour: 'Black', sku: 'YAQ-BLK-S', stock: 0, status: 'pending' }
    ]),
    /status is invalid/i
  );
  assert.throws(
    () => validateVariantMatrix(['S'], [{ name: 'Black' }], [
      { size: 'S', colour: 'Black', sku: 'YAQ-BLK-S', stock: 0, images: ['javascript:alert(1)'] }
    ]),
    /image URL/i
  );
});

test('legacy variants default to active and client edits cannot set reservation or acquisition-cost fields', () => {
  const [variant] = validateVariantMatrix(['M'], [{ name: 'Stone' }], [{
    size: 'M',
    colour: 'Stone',
    sku: 'YAQ-STN-M',
    stock: 3,
    reservedQuantity: 2,
    unitCostPaise: 10000,
    costedQuantity: 3
  }]);

  assert.equal(variant.status, 'active');
  assert.equal('reservedQuantity' in variant, false);
  assert.equal('unitCostPaise' in variant, false);
  assert.equal('costedQuantity' in variant, false);
});

test('product serialization redacts reserved and acquisition-cost variant data', async () => {
  const product = new Product({
    name: 'Private Inventory Tee',
    slug: 'private-inventory-tee',
    description: 'Variant serialization fixture',
    category: 'T-Shirts',
    pricePaise: 250000,
    sizes: ['M'],
    colours: [{ name: 'Black' }],
    variants: [{
      size: 'M',
      colour: 'Black',
      sku: 'YAQ-PRIVATE-M',
      stock: 4,
      reservedQuantity: 2,
      unitCostPaise: 120000,
      costedQuantity: 4
    }]
  });

  await product.validate();
  assert.equal(product.variants[0].reservedQuantity, 2);
  const serializedVariant = product.toJSON().variants[0];
  assert.equal('reservedQuantity' in serializedVariant, false);
  assert.equal('unitCostPaise' in serializedVariant, false);
  assert.equal('costedQuantity' in serializedVariant, false);
});

test('variant-enabled products derive aggregate stock while legacy products retain aggregate stock', async () => {
  const variantProduct = new Product({
    name: 'Variant Tee',
    slug: 'variant-tee',
    description: 'Variant product',
    category: 'T-Shirts',
    pricePaise: 250000,
    sizes: ['S', 'M'],
    colours: [{ name: 'Black', hex: '#000000' }, { name: 'Stone', hex: '#CCCCCC' }],
    variants: [
      { size: 'S', colour: 'Black', sku: 'YAQ-TEE-BLK-S', stock: 4 },
      { size: 'S', colour: 'Stone', sku: 'YAQ-TEE-STN-S', stock: 2 },
      { size: 'M', colour: 'Black', sku: 'YAQ-TEE-BLK-M', stock: 0 },
      { size: 'M', colour: 'Stone', sku: 'YAQ-TEE-STN-M', stock: 7 }
    ],
    images: ['/images/variant-tee.jpg']
  });
  await variantProduct.validate();
  assert.equal(variantProduct.stock, 13);

  const legacyProduct = new Product({
    name: 'Legacy Tee',
    slug: 'legacy-tee',
    description: 'Legacy product',
    category: 'T-Shirts',
    pricePaise: 250000,
    stock: 12,
    images: ['/images/legacy-tee.jpg']
  });
  await legacyProduct.validate();
  assert.equal(legacyProduct.stock, 12);
});

test('product lifecycle status controls whether a product is publicly active', async () => {
  const draftProduct = new Product({
    name: 'Draft Tee',
    slug: 'draft-tee',
    description: 'Unpublished product',
    category: 'T-Shirts',
    pricePaise: 250000,
    status: 'draft'
  });

  await draftProduct.validate();
  assert.equal(draftProduct.status, 'draft');
  assert.equal(draftProduct.active, false);

  draftProduct.status = 'active';
  await draftProduct.validate();
  assert.equal(draftProduct.active, true);

  draftProduct.status = 'discontinued';
  await draftProduct.validate();
  assert.equal(draftProduct.active, false);
});

test('product edits cannot change stock outside the inventory adjustment workflow', () => {
  const saved = [{ size: 'S', colour: 'Black', sku: 'YAQ-TEE-BLK-S', stock: 5 }];
  assert.throws(
    () => assertVariantInventoryUnchanged(saved, [{ size: 'S', colour: 'Black', sku: 'YAQ-TEE-BLK-S', stock: 4 }]),
    /inventory adjustments/
  );
  assert.throws(
    () => assertVariantInventoryUnchanged(saved, []),
    /Stocked variants/
  );
  assert.doesNotThrow(() => assertVariantInventoryUnchanged(saved, [
    { size: 'S', colour: 'Black', sku: 'YAQ-TEE-BLK-S', stock: 5 },
    { size: 'M', colour: 'Black', sku: 'YAQ-TEE-BLK-M', stock: 0 }
  ]));
});

test('checkout and cancellation change one SKU and the product aggregate together', () => {
  assert.deepEqual(buildVariantStockAdjustment('YAQ-TEE-BLK-S', 2, 'decrease'), {
    filter: { sku: 'YAQ-TEE-BLK-S', stock: { $gte: 2 } },
    update: { $inc: { 'variants.$.stock': -2, stock: -2 } }
  });
  assert.deepEqual(buildVariantStockAdjustment('YAQ-TEE-BLK-S', 2, 'increase'), {
    filter: { sku: 'YAQ-TEE-BLK-S' },
    update: { $inc: { 'variants.$.stock': 2, stock: 2 } }
  });
  assert.throws(() => buildVariantStockAdjustment('YAQ-TEE-BLK-S', 0, 'decrease'), /quantity/);
});

test('stock movement snapshots record before and after counts for variants and legacy products', () => {
  assert.deepEqual(buildStockMovementChange(
    { _id: 'product-1', name: 'Core Tee', stock: 11 },
    { size: 'S', colour: 'Black', sku: 'YAQ-TEE-BLK-S', stock: 4 },
    -2
  ), {
    product: 'product-1',
    productName: 'Core Tee',
    sku: 'YAQ-TEE-BLK-S',
    size: 'S',
    colour: 'Black',
    quantityDelta: -2,
    stockBefore: 4,
    stockAfter: 2
  });
  assert.deepEqual(buildStockMovementChange(
    { _id: 'product-2', name: 'Legacy Tee', stock: 7 },
    null,
    3
  ), {
    product: 'product-2',
    productName: 'Legacy Tee',
    sku: null,
    size: '',
    colour: '',
    quantityDelta: 3,
    stockBefore: 7,
    stockAfter: 10
  });
});
