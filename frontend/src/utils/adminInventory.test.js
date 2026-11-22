import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getInventoryDrawerState,
  getInventoryKpiFilter,
  groupInventoryByColour,
  getQuickAdjustmentDelta,
  getInventoryVariantOptions,
  getInventoryReceiptTargetOptions
} from './adminInventory.js';

test('adjustment drawer state identifies exact SKU, size and colour', () => {
  assert.deepEqual(getInventoryDrawerState({
    productName: 'Core Tee',
    sku: 'CORE-BLK-M',
    colour: 'Black',
    size: 'M',
    image: '/images/core-tee-black-m.jpg'
  }), {
    title: 'Core Tee',
    identity: 'Black · M',
    sku: 'CORE-BLK-M',
    image: '/images/core-tee-black-m.jpg'
  });
});

test('inventory KPI cards map to visible filters', () => {
  assert.deepEqual(getInventoryKpiFilter('Low-stock SKUs'), { status: 'low_stock' });
  assert.deepEqual(getInventoryKpiFilter('Out-of-stock SKUs'), { status: 'out_of_stock' });
  assert.equal(getInventoryKpiFilter('Reserved stock'), null);
  assert.equal(getInventoryKpiFilter('Physical stock'), null);
});

test('inventory rows group by actual colour and retain zero-stock SKUs', () => {
  const groups = groupInventoryByColour([
    { sku: 'TEE-BLK-S', colour: 'Black', size: 'S', onHand: 0, variantStatus: 'active' },
    { sku: 'TEE-BLK-M', colour: 'Black', size: 'M', onHand: 4, variantStatus: 'active' },
    { sku: 'TEE-NAV-S', colour: 'Navy', size: 'S', onHand: 2, variantStatus: 'active' }
  ]);
  assert.deepEqual(groups.map((group) => group.colour), ['Black', 'Navy']);
  assert.equal(groups[0].variants.length, 2);
  assert.equal(groups[0].variants[0].size, 'S');
});

test('quick adjustment controls add or subtract bounded unit deltas', () => {
  assert.equal(getQuickAdjustmentDelta(7, 1), 8);
  assert.equal(getQuickAdjustmentDelta(7, -5), 2);
  assert.equal(getQuickAdjustmentDelta(-2, -1), -3);
});

test('inventory adjustment exposes every colour-size SKU of the selected product', () => {
  const options = getInventoryVariantOptions({
    _id: 'demo-tee',
    variants: [
      { sku: 'YQ-GRN-S', colour: 'Green', size: 'S', status: 'active', stock: 0 },
      { sku: 'YQ-GRN-M', colour: 'Green', size: 'M', status: 'inactive', stock: 4 },
      { sku: 'YQ-BLU-M', colour: 'Blue', size: 'M', status: 'active', stock: 8 }
    ]
  });
  assert.deepEqual(options, [
    { value: 'YQ-GRN-S', label: 'Green · S · YQ-GRN-S · active' },
    { value: 'YQ-GRN-M', label: 'Green · M · YQ-GRN-M · inactive' },
    { value: 'YQ-BLU-M', label: 'Blue · M · YQ-BLU-M · active' }
  ]);
});

test('inbound target choices include every SKU instead of only the visible inventory page', () => {
  const products = [{
    _id: 'demo-tee',
    name: 'DEMO Tee',
    variants: [
      { sku: 'YQ-GRN-M', colour: 'Green', size: 'M', status: 'active' },
      { sku: 'YQ-BLU-M', colour: 'Blue', size: 'M', status: 'active' }
    ]
  }, {
    _id: 'legacy-shirt',
    name: 'Legacy Shirt',
    variants: []
  }];
  assert.deepEqual(getInventoryReceiptTargetOptions(products), [
    { value: 'YQ-GRN-M', productId: 'demo-tee', sku: 'YQ-GRN-M', label: 'DEMO Tee · Green · M · YQ-GRN-M' },
    { value: 'YQ-BLU-M', productId: 'demo-tee', sku: 'YQ-BLU-M', label: 'DEMO Tee · Blue · M · YQ-BLU-M' },
    { value: 'legacy-shirt', productId: 'legacy-shirt', sku: null, label: 'Legacy Shirt · Legacy stock' }
  ]);
});
