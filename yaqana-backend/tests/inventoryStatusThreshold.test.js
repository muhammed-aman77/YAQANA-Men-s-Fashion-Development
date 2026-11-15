import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../src/models/Product.js';
import { getInventory } from '../src/controllers/inventoryController.js';

test('inventory API uses the dashboard threshold and reports real stock totals', async (t) => {
  const originalFind = Product.find;
  Product.find = () => ({
    select() { return this; },
    sort() { return this; },
    lean: async () => [
      {
        _id: 'product-at-threshold',
        name: 'Threshold Test Product',
        category: 'Test',
        active: true,
        stock: 10,
        variants: []
      },
      {
        _id: 'variant-product',
        name: 'Variant Test Product',
        category: 'Test',
        active: true,
        stock: 4,
        variants: [
          { sku: 'TEST-SKU-ZERO', size: 'S', colour: 'Black', stock: 0 },
          { sku: 'TEST-SKU-LOW', size: 'M', colour: 'Black', stock: 4 }
        ]
      }
    ]
  });
  t.after(() => { Product.find = originalFind; });

  const response = {
    body: null,
    json(body) { this.body = body; return this; }
  };
  await getInventory({}, response, (error) => { throw error; });

  assert.equal(response.body.lowStockThreshold, 10);
  assert.equal(response.body.inventory[0].status, 'low_stock');
  assert.deepEqual(response.body.summary, {
    totalProducts: 2,
    stockRecords: 3,
    unitsOnHand: 14,
    lowStockRecords: 2,
    outOfStockRecords: 1
  });
});
