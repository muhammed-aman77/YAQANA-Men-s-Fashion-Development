import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardLowStockSummary } from '../src/utils/inventoryReadModel.js';
import Product from '../src/models/Product.js';
import InventoryPolicy from '../src/models/InventoryPolicy.js';
import Order from '../src/models/Order.js';
import User from '../src/models/User.js';
import { getDashboardStats } from '../src/controllers/adminController.js';

test('dashboard low stock groups low-availability active SKUs by product using reservations and configured policy', () => {
  const summary = buildDashboardLowStockSummary([
    {
      _id: 'product-a', name: 'Variant shirt', active: true, stock: 900,
      variants: [
        { sku: 'A-S', status: 'active', stock: 12, reservedQuantity: 8 },
        { sku: 'A-M', status: 'active', stock: 30, reservedQuantity: 2 }
      ]
    },
    {
      _id: 'product-b', name: 'Stale aggregate low', active: true, stock: 1,
      variants: [{ sku: 'B-S', status: 'active', stock: 20, reservedQuantity: 0 }]
    },
    {
      _id: 'product-c', name: 'Multiple low variants', active: true, stock: 800,
      variants: [
        { sku: 'C-S', status: 'active', stock: 4, reservedQuantity: 0 },
        { sku: 'C-M', status: 'active', stock: 9, reservedQuantity: 5 }
      ]
    },
    {
      _id: 'product-d', name: 'Fully reserved', active: true, stock: 500,
      variants: [{ sku: 'D-S', status: 'active', stock: 3, reservedQuantity: 3 }]
    },
    {
      _id: 'product-e', name: 'Inactive product', active: false, stock: 0,
      variants: [{ sku: 'E-S', status: 'active', stock: 2, reservedQuantity: 0 }]
    }
  ], { lowStockThreshold: 5, criticalStockThreshold: 2 });

  assert.equal(summary.count, 2);
  assert.deepEqual(summary.products.map(({ productId, name, variants }) => ({
    productId,
    name,
    variants: variants.map(({ sku, availableStock }) => ({ sku, availableStock }))
  })), [
    { productId: 'product-a', name: 'Variant shirt', variants: [{ sku: 'A-S', availableStock: 4 }] },
    { productId: 'product-c', name: 'Multiple low variants', variants: [
      { sku: 'C-S', availableStock: 4 },
      { sku: 'C-M', availableStock: 4 }
    ] }
  ]);
});

test('dashboard low-stock summary uses the inventory model default threshold when no policy exists', () => {
  const summary = buildDashboardLowStockSummary([
    { _id: 'product-a', name: 'Default threshold', active: true, variants: [
      { sku: 'A-S', status: 'active', stock: 10, reservedQuantity: 0 }
    ] }
  ]);
  assert.equal(summary.count, 1);
  assert.equal(summary.products[0].variants[0].availableStock, 10);
});

test('dashboard stats count unique products with low available active variants rather than aggregate stock', async (t) => {
  const products = [
    { _id: 'product-a', name: 'Variant shirt', active: true, stock: 900, variants: [
      { sku: 'A-S', status: 'active', stock: 12, reservedQuantity: 8 },
      { sku: 'A-M', status: 'active', stock: 30, reservedQuantity: 2 }
    ] },
    { _id: 'product-b', name: 'Stale aggregate low', active: true, stock: 1, variants: [
      { sku: 'B-S', status: 'active', stock: 20, reservedQuantity: 0 }
    ] },
    { _id: 'product-c', name: 'Two low SKUs', active: true, stock: 800, variants: [
      { sku: 'C-S', status: 'active', stock: 4, reservedQuantity: 0 },
      { sku: 'C-M', status: 'active', stock: 9, reservedQuantity: 5 }
    ] }
  ];
  t.mock.method(Product, 'countDocuments', async () => 3);
  t.mock.method(Product, 'find', (query) => {
    assert.deepEqual(query, { active: { $ne: false } });
    const queryResult = {
      select(fields) { assert.equal(fields, 'name active stock variants'); return this; },
      then(resolve, reject) { return Promise.resolve(products).then(resolve, reject); }
    };
    return queryResult;
  });
  t.mock.method(Product, 'aggregate', async () => []);
  t.mock.method(InventoryPolicy, 'findOne', () => ({ lean: async () => ({ lowStockThreshold: 5, criticalStockThreshold: 2 }) }));
  t.mock.method(Order, 'countDocuments', async () => 0);
  t.mock.method(Order, 'aggregate', async () => []);
  t.mock.method(Order, 'find', () => {
    const query = {
      sort() { return this; },
      limit() { return this; },
      populate() { return this; },
      then(resolve, reject) { return Promise.resolve([]).then(resolve, reject); }
    };
    return query;
  });
  t.mock.method(User, 'countDocuments', async () => 0);
  t.mock.method(User, 'aggregate', async () => []);

  let body;
  await getDashboardStats({ query: {} }, { json(value) { body = value; return this; } }, (error) => { throw error; });
  assert.equal(body.stats.lowStockProducts, 2);
});
