import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildColourSkuGroups,
  buildLegacyAllocationPreview,
  normalizeVerifiedUnitCost,
  previewStocktake,
  previewInventoryCsv
} from '../src/utils/inventoryOperations.js';

test('colour-size SKU groups keep zero-stock and inactive variants visible with sellable counts separate', () => {
  const groups = buildColourSkuGroups([
    { sku: 'TEE-BLK-S', colour: 'Black', size: 'S', stock: 0, status: 'active' },
    { sku: 'TEE-BLK-M', colour: 'Black', size: 'M', stock: 4, status: 'inactive' },
    { sku: 'TEE-NAV-S', colour: 'Navy', size: 'S', stock: 2, status: 'active' }
  ]);

  assert.deepEqual(groups.map((group) => group.colour), ['Black', 'Navy']);
  assert.equal(groups[0].variants[0].sku, 'TEE-BLK-S');
  assert.equal(groups[0].activeSellableSkuCount, 0);
  assert.equal(groups[1].activeSellableSkuCount, 1);
});

test('legacy allocation preview reconciles without guessing distribution', () => {
  const preview = buildLegacyAllocationPreview({
    productName: 'Core Tee',
    originalStock: 28,
    availableSkus: ['CORE-BLK-S', 'CORE-BLK-M'],
    allocations: [
      { sku: 'CORE-BLK-S', quantity: 10 },
      { sku: 'CORE-BLK-M', quantity: 8 }
    ]
  });
  assert.equal(preview.allocatedQuantity, 18);
  assert.equal(preview.unallocatedQuantity, 10);
  assert.equal(preview.reconciles, true);
  assert.equal(preview.status, 'review');
});

test('legacy allocation rejects negative, duplicate, or excessive allocations', () => {
  assert.throws(() => buildLegacyAllocationPreview({
    productName: 'Core Tee',
    originalStock: 28,
    availableSkus: ['CORE-BLK-S'],
    allocations: [{ sku: 'CORE-BLK-S', quantity: -1 }]
  }), /negative|quantity/i);
  assert.throws(() => buildLegacyAllocationPreview({
    productName: 'Core Tee',
    originalStock: 28,
    availableSkus: ['CORE-BLK-S'],
    allocations: [{ sku: 'CORE-BLK-S', quantity: 10 }, { sku: 'CORE-BLK-S', quantity: 5 }]
  }), /duplicate/i);
  assert.throws(() => buildLegacyAllocationPreview({
    productName: 'Core Tee',
    originalStock: 28,
    availableSkus: ['CORE-BLK-S'],
    allocations: [{ sku: 'CORE-BLK-S', quantity: 29 }]
  }), /exceed/i);
});

test('legacy allocation preview accepts only SKUs belonging to the product', () => {
  assert.throws(() => buildLegacyAllocationPreview({
    originalStock: 10,
    availableSkus: ['CORE-BLK-S'],
    allocations: [{ sku: 'OTHER-PRODUCT-M', quantity: 2 }]
  }), /belong|unknown|not found/i);
});

test('verified unit cost is integer-paise and never accepts selling price as cost', () => {
  assert.equal(normalizeVerifiedUnitCost(1200), 120000);
  assert.throws(() => normalizeVerifiedUnitCost(-1), /cost/i);
  assert.throws(() => normalizeVerifiedUnitCost('not-money'), /cost/i);
});

test('stocktake preview calculates variance and requires confirmation', () => {
  assert.deepEqual(previewStocktake({ recordedQuantity: 28, countedQuantity: 25 }), {
    recordedQuantity: 28,
    countedQuantity: 25,
    variance: -3,
    requiresConfirmation: true
  });
  assert.throws(() => previewStocktake({ recordedQuantity: 28, countedQuantity: -1 }), /counted/i);
});

test('CSV import preview validates matching SKUs and duplicate/invalid rows', () => {
  const preview = previewInventoryCsv({
    csvText: 'SKU,Quantity,Reason\nCORE-BLK-S,5,Stocktake\nCORE-BLK-M,-1,Stocktake\nCORE-BLK-S,2,Stocktake',
    availableSkus: ['CORE-BLK-S', 'CORE-BLK-M']
  });
  assert.equal(preview.validRows, 1);
  assert.equal(preview.invalidRows, 2);
  assert.equal(preview.duplicates, 1);
});
