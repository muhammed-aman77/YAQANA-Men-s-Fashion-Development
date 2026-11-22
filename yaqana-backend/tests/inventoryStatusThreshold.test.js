import test from 'node:test';
import assert from 'node:assert/strict';
import InventoryInbound from '../src/models/InventoryInbound.js';
import InventoryPolicy from '../src/models/InventoryPolicy.js';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import StockMovement from '../src/models/StockMovement.js';
import { getInventory } from '../src/controllers/inventoryController.js';

test('inventory API uses the dashboard threshold and reports real stock totals', async (t) => {
  const originals = {
    productFind: Product.find,
    policyFindOne: InventoryPolicy.findOne,
    inboundFind: InventoryInbound.find,
    orderFind: Order.find,
    orderFindOne: Order.findOne,
    movementAggregate: StockMovement.aggregate
  };
  const query = (value) => ({
    select() { return this; },
    sort() { return this; },
    lean: async () => value
  });
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
  InventoryPolicy.findOne = () => query(null);
  InventoryInbound.find = () => query([]);
  Order.find = () => query([]);
  Order.findOne = () => query(null);
  StockMovement.aggregate = async () => [];
  t.after(() => {
    Product.find = originals.productFind;
    InventoryPolicy.findOne = originals.policyFindOne;
    InventoryInbound.find = originals.inboundFind;
    Order.find = originals.orderFind;
    Order.findOne = originals.orderFindOne;
    StockMovement.aggregate = originals.movementAggregate;
  });

  const response = {
    body: null,
    json(body) { this.body = body; return this; }
  };
  await getInventory({ query: {} }, response, (error) => { throw error; });

  assert.equal(response.body.lowStockThreshold, 10);
  assert.equal(response.body.inventory[0].status, 'low_stock');
  assert.equal(response.body.summary.totalProducts, 2);
  assert.equal(response.body.summary.stockRecords, 3);
  assert.equal(response.body.summary.unitsOnHand, 14);
  assert.equal(response.body.summary.availableUnits, 14);
  assert.equal(response.body.summary.lowStockRecords, 2);
  assert.equal(response.body.summary.outOfStockRecords, 1);
});
