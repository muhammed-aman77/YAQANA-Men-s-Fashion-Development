import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoCatalogFixture } from '../src/utils/demoCatalogFixture.js';

test('demo fixture creates complete colour-size matrices with unique demo SKUs', () => {
  const fixture = buildDemoCatalogFixture();
  assert.equal(fixture.products.length, 18);

  const allSkus = fixture.products.flatMap((product) => product.variants.map((variant) => variant.sku));
  assert.equal(new Set(allSkus).size, allSkus.length);
  assert.ok(allSkus.every((sku) => sku.startsWith('YQ-DEMO-')));

  for (const product of fixture.products) {
    assert.equal(product.isDemoData, true);
    assert.ok(product.demoKey.startsWith('YAQANA-DEMO-'));
    assert.ok(product.description.startsWith('DEMO DATA'));
    const combinations = new Set(product.variants.map((variant) => `${variant.colour}\0${variant.size}`));
    assert.equal(combinations.size, product.variants.length);
    for (const colour of product.colours) {
      for (const size of product.sizes) {
        assert.ok(combinations.has(`${colour.name}\0${size}`));
      }
    }
  }
});

test('demo fixture includes zero, low, normal, inactive and discontinued examples', () => {
  const fixture = buildDemoCatalogFixture();
  const variants = fixture.products.flatMap((product) => product.variants);
  assert.ok(variants.some((variant) => variant.stock === 0));
  assert.ok(variants.some((variant) => variant.stock > 0 && variant.stock <= 5));
  assert.ok(variants.some((variant) => variant.status === 'inactive'));
  assert.ok(variants.some((variant) => variant.status === 'discontinued'));
  assert.ok(variants.every((variant) => Number.isSafeInteger(variant.stock) && variant.stock >= 0));
});

test('demo fixture stock is independent and acquisition cost coverage is coherent', () => {
  const fixture = buildDemoCatalogFixture();
  for (const product of fixture.products) {
    assert.ok(Number.isSafeInteger(product.stock));
    assert.equal(product.stock, product.variants.reduce((sum, variant) => sum + variant.stock, 0));
    assert.ok(product.variants.every((variant) =>
      Number.isSafeInteger(variant.unitCostPaise) && variant.unitCostPaise >= 0
    ));
  }
});
