import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDemoSizesForColour,
  isDemoVariantSelectable,
  getDemoVariantAvailabilityText
} from './demoCatalogue.js';

const demoProduct = {
  isDemoData: true,
  variants: [
    { size: 'S', colour: 'Green', sku: 'YQ-DEMO-GRN-S', stock: 0, status: 'active' },
    { size: 'M', colour: 'Green', sku: 'YQ-DEMO-GRN-M', stock: 5, status: 'active', reservedQuantity: 1 },
    { size: 'L', colour: 'Green', sku: 'YQ-DEMO-GRN-L', stock: 2, status: 'inactive' },
    { size: 'M', colour: 'Black', sku: 'YQ-DEMO-BLK-M', stock: 8, status: 'active' }
  ]
};

test('demo colour selection returns only sizes configured for that colour', () => {
  assert.deepEqual(getDemoSizesForColour(demoProduct, 'Green'), ['S', 'M', 'L']);
  assert.deepEqual(getDemoSizesForColour(demoProduct, 'Black'), ['M']);
});

test('inactive, discontinued and zero-available demo variants are not selectable', () => {
  assert.equal(isDemoVariantSelectable(demoProduct, 'Green', 'S'), false);
  assert.equal(isDemoVariantSelectable(demoProduct, 'Green', 'M'), true);
  assert.equal(isDemoVariantSelectable(demoProduct, 'Green', 'L'), false);
  assert.equal(isDemoVariantSelectable(demoProduct, 'Black', 'M'), true);
});

test('demo availability text exposes zero and reserved availability', () => {
  assert.equal(getDemoVariantAvailabilityText(demoProduct, 'Green', 'S'), 'Out of stock');
  assert.equal(getDemoVariantAvailabilityText(demoProduct, 'Green', 'M'), '4 available');
  assert.equal(getDemoVariantAvailabilityText(demoProduct, 'Green', 'L'), 'Unavailable');
});
