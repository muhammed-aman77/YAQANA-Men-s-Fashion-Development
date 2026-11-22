import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import InventoryInbound from '../src/models/InventoryInbound.js';
import AdminAudit from '../src/models/AdminAudit.js';
import InventoryPolicy from '../src/models/InventoryPolicy.js';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import StockMovement from '../src/models/StockMovement.js';
import {
  adjustInventory,
  exportInventoryCsv,
  getLegacyAllocationPreview,
  getInventory,
  previewInventoryAllocation,
  setInventoryReorderTarget,
  updateVerifiedUnitCost
} from '../src/controllers/inventoryController.js';

const makeQuery = (value) => ({
  select() { return this; },
  sort() { return this; },
  lean: async () => value
});

function stubInventorySnapshot(t, products) {
  const originals = {
    productFind: Product.find,
    policyFindOne: InventoryPolicy.findOne,
    inboundFind: InventoryInbound.find,
    orderFind: Order.find,
    orderFindOne: Order.findOne,
    movementAggregate: StockMovement.aggregate
  };
  Product.find = () => makeQuery(products);
  InventoryPolicy.findOne = () => makeQuery(null);
  InventoryInbound.find = () => makeQuery([]);
  Order.find = () => makeQuery([]);
  Order.findOne = () => makeQuery(null);
  StockMovement.aggregate = async () => [];
  t.after(() => {
    Product.find = originals.productFind;
    InventoryPolicy.findOne = originals.policyFindOne;
    InventoryInbound.find = originals.inboundFind;
    Order.find = originals.orderFind;
    Order.findOne = originals.orderFindOne;
    StockMovement.aggregate = originals.movementAggregate;
  });
}

function makeResponse() {
  return {
    headers: {},
    body: null,
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; return this; }
  };
}

const products = [
  {
    _id: 'product-tee',
    name: 'Core Tee',
    category: 'T-Shirts',
    active: true,
    stock: 0,
    pricePaise: 10000,
    variants: [
      { sku: 'CORE-TEE-S', size: 'S', colour: 'Black', stock: 5, reservedQuantity: 1 },
      { sku: 'CORE-TEE-M', size: 'M', colour: 'Black', stock: 12, status: 'discontinued' }
    ]
  },
  {
    _id: 'product-shirt',
    name: 'Linen Shirt',
    category: 'Shirts',
    active: true,
    stock: 4,
    pricePaise: 20000,
    variants: []
  }
];

test('inventory endpoint filters and paginates SKU rows while retaining whole-stock summary', async (t) => {
  stubInventorySnapshot(t, products);
  const response = makeResponse();
  let forwardedError;

  await getInventory({
    query: { search: 'tee', page: '1', limit: '1', sort: 'sku-desc' }
  }, response, (error) => { forwardedError = error; });

  assert.ifError(forwardedError);
  assert.deepEqual(response.body.inventory.map((row) => row.sku), ['CORE-TEE-S']);
  assert.equal(response.body.summary.totalProducts, 2);
  assert.equal(response.body.summary.unitsOnHand, 21);
  assert.equal(response.body.transactionSupportAvailable, false);
  assert.equal(response.body.totalCount, 2);
  assert.equal(response.body.currentPage, 1);
  assert.equal(response.body.pageSize, 1);
});

test('inventory endpoint filters by variant lifecycle without changing stock', async (t) => {
  stubInventorySnapshot(t, products);
  const response = makeResponse();
  let forwardedError;

  await getInventory({ query: { variantStatus: 'discontinued' } }, response, (error) => { forwardedError = error; });

  assert.ifError(forwardedError);
  assert.deepEqual(response.body.inventory.map((row) => row.sku), ['CORE-TEE-M']);
  assert.equal(response.body.summary.unitsOnHand, 21);
});

test('inventory endpoint rejects unknown variant lifecycle filters before loading data', async () => {
  let forwardedError;
  await getInventory({ query: { variantStatus: 'deleted' } }, makeResponse(), (error) => { forwardedError = error; });
  assert.equal(forwardedError?.statusCode, 400);
});

test('legacy allocation preview validates against the selected product SKU list', async (t) => {
  const originalFindById = Product.findById;
  Product.findById = () => makeQuery({
    name: 'Core Tee',
    stock: 10,
    variants: [{ sku: 'CORE-TEE-S', size: 'S', colour: 'Black', stock: 0 }]
  });
  t.after(() => { Product.findById = originalFindById; });

  const response = makeResponse();
  let forwardedError;
  await previewInventoryAllocation({
    params: { productId: '507f1f77bcf86cd799439011' },
    body: { allocations: [{ sku: 'CORE-TEE-S', quantity: 4 }] }
  }, response, (error) => { forwardedError = error; });

  assert.ifError(forwardedError);
  assert.equal(response.body.preview.allocatedQuantity, 4);
  assert.equal(response.body.preview.unallocatedQuantity, 6);
});

test('legacy allocation preview rejects an SKU belonging to another product', async (t) => {
  const originalFindById = Product.findById;
  Product.findById = () => makeQuery({
    name: 'Core Tee',
    stock: 10,
    variants: [{ sku: 'CORE-TEE-S', size: 'S', colour: 'Black', stock: 0 }]
  });
  t.after(() => { Product.findById = originalFindById; });

  let forwardedError;
  await previewInventoryAllocation({
    params: { productId: '507f1f77bcf86cd799439011' },
    body: { allocations: [{ sku: 'OTHER-PRODUCT-M', quantity: 2 }] }
  }, makeResponse(), (error) => { forwardedError = error; });

  assert.equal(forwardedError?.statusCode, 400);
});

test('legacy allocation query rejects malformed entries instead of silently omitting them', async (t) => {
  const originalFindById = Product.findById;
  Product.findById = () => makeQuery({
    name: 'Core Tee',
    stock: 10,
    variants: [{ sku: 'CORE-TEE-S', size: 'S', colour: 'Black', stock: 0 }]
  });
  t.after(() => { Product.findById = originalFindById; });

  let forwardedError;
  await getLegacyAllocationPreview({
    params: { productId: '507f1f77bcf86cd799439011' },
    query: { allocation: 'CORE-TEE-S:invalid' }
  }, makeResponse(), (error) => { forwardedError = error; });

  assert.equal(forwardedError?.statusCode, 400);
});

test('inventory CSV endpoint returns only the selected operational rows', async (t) => {
  stubInventorySnapshot(t, products);
  const response = makeResponse();
  let forwardedError;

  await exportInventoryCsv({
    query: { category: 'Shirts' }
  }, response, (error) => { forwardedError = error; });

  assert.ifError(forwardedError);
  assert.match(response.headers['Content-Type'], /^text\/csv;/);
  assert.match(response.body, /Linen Shirt/);
  assert.doesNotMatch(response.body, /Core Tee|email|customer|payment/i);
});

test('reorder target endpoint updates the selected SKU and records actor and before/after audit', async (t) => {
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  const originalFindOne = Product.findOne;
  const originalAuditCreate = AdminAudit.create;
  let updateArgs;
  const auditRecords = [];
  Product.findOne = () => ({ select() { return this; }, lean: async () => ({ variants: [{ sku: 'CORE-TEE-S', reorderTarget: 5 }] }) });
  Product.findOneAndUpdate = (...args) => {
    updateArgs = args;
    return makeQuery({
      variants: [{ sku: 'CORE-TEE-S', reorderTarget: 5 }]
    });
  };
  AdminAudit.create = async (record) => { auditRecords.push(record); };
  t.after(() => {
    Product.findOneAndUpdate = originalFindOneAndUpdate;
    Product.findOne = originalFindOne;
    AdminAudit.create = originalAuditCreate;
  });

  const response = makeResponse();
  let forwardedError;
  await setInventoryReorderTarget({
    params: { sku: 'core-tee-s' },
    body: { reorderTarget: 18 },
    user: { _id: 'admin-1' }
  }, response, (error) => { forwardedError = error; });

  assert.ifError(forwardedError);
  assert.deepEqual(updateArgs[0], { variants: { $elemMatch: { sku: 'CORE-TEE-S', reorderTarget: 5 } } });
  assert.deepEqual(updateArgs[1], { $set: { 'variants.$.reorderTarget': 18 } });
  assert.equal(updateArgs[2].new, false);
  assert.equal(response.body.reorderTarget, 18);
  const auditRecord = auditRecords.find(({ action }) => action === 'inventory.reorder_target.update');
  assert.equal(auditRecord.actor, 'admin-1');
  assert.deepEqual(auditRecord.before, { reorderTarget: 5 });
  assert.deepEqual(auditRecord.after, { reorderTarget: 18 });
  assert.equal(auditRecord.reason, 'Administrator updated an SKU reorder target.');
  assert.equal(auditRecords[0].action, 'inventory.reorder_target.update.started');
});

test('reorder target is not changed when its audit intent cannot be persisted', async (t) => {
  const originals = { findOne: Product.findOne, update: Product.findOneAndUpdate, audit: AdminAudit.create };
  let updateCalled = false;
  Product.findOne = () => ({ select() { return this; }, lean: async () => ({ variants: [{ sku: 'CORE-TEE-S', reorderTarget: 5 }] }) });
  Product.findOneAndUpdate = () => { updateCalled = true; return makeQuery(null); };
  AdminAudit.create = async () => { throw new Error('audit storage unavailable'); };
  t.after(() => {
    Product.findOne = originals.findOne;
    Product.findOneAndUpdate = originals.update;
    AdminAudit.create = originals.audit;
  });
  let forwardedError;
  await setInventoryReorderTarget({ params: { sku: 'CORE-TEE-S' }, body: { reorderTarget: 20 }, user: { _id: 'admin-1' } }, makeResponse(), (error) => { forwardedError = error; });
  assert.match(forwardedError?.message || '', /audit storage unavailable/);
  assert.equal(updateCalled, false);
});

test('verified unit-cost mutation records actor and before/after without copying free-text reason', async (t) => {
  const previousClient = mongoose.connection.client;
  const previousFindOne = Product.findOne;
  const previousStartSession = mongoose.startSession;
  const previousAuditCreate = AdminAudit.create;
  const product = {
    _id: '507f1f77bcf86cd799439011',
    variants: [{ sku: 'CORE-TEE-S', stock: 12, unitCostPaise: 1000, costedQuantity: 2 }],
    async save() {}
  };
  let auditRecord;
  mongoose.connection.client = { topology: { description: { type: 'ReplicaSetWithPrimary' } } };
  Product.findOne = () => ({ session: async () => product });
  mongoose.startSession = async () => ({
    withTransaction: async (work) => work(),
    endSession: async () => {}
  });
  AdminAudit.create = async (records, options) => { auditRecord = { records, options }; };
  t.after(() => {
    mongoose.connection.client = previousClient;
    Product.findOne = previousFindOne;
    mongoose.startSession = previousStartSession;
    AdminAudit.create = previousAuditCreate;
  });

  const response = makeResponse();
  let forwardedError;
  await updateVerifiedUnitCost({
    params: { sku: 'core-tee-s' },
    body: { unitCost: 20, costedQuantity: 3, reason: 'supplier correction' },
    user: { _id: '507f1f77bcf86cd799439013' }
  }, response, (error) => { forwardedError = error; });

  assert.ifError(forwardedError);
  assert.equal(auditRecord.records[0].actor, '507f1f77bcf86cd799439013');
  assert.equal(auditRecord.records[0].action, 'inventory.unit_cost.update');
  assert.deepEqual(auditRecord.records[0].before, { unitCostPaise: 1000, costedQuantity: 2 });
  assert.deepEqual(auditRecord.records[0].after, { unitCostPaise: 2000, costedQuantity: 3 });
  assert.equal(auditRecord.records[0].reason, 'Administrator updated verified unit cost.');
  assert.equal(JSON.stringify(auditRecord.records).includes('supplier correction'), false);
  assert.ok(auditRecord.options.session);
});

test('inventory adjustment rejects non-string audit metadata before database access', async (t) => {
  const originalFindOne = StockMovement.findOne;
  StockMovement.findOne = () => { throw new Error('database access attempted'); };
  t.after(() => { StockMovement.findOne = originalFindOne; });

  let forwardedError;
  await adjustInventory({
    body: {
      adjustments: [{ sku: 'CORE-TEE-S', delta: 1 }],
      reason: 'Stock correction',
      reference: 17
    },
    user: { _id: '507f1f77bcf86cd799439012' },
    get: () => 'inventory-adjustment-test-001'
  }, makeResponse(), (error) => { forwardedError = error; });

  assert.equal(forwardedError?.statusCode, 400);
});

test('inventory adjustment rejects damage and loss entries that add stock', async (t) => {
  const originalFindOne = StockMovement.findOne;
  StockMovement.findOne = () => { throw new Error('database access attempted'); };
  t.after(() => { StockMovement.findOne = originalFindOne; });

  let forwardedError;
  await adjustInventory({
    body: {
      adjustments: [{ sku: 'CORE-TEE-S', delta: 1 }],
      reason: 'Damaged item',
      type: 'damaged'
    },
    user: { _id: '507f1f77bcf86cd799439012' },
    get: () => 'inventory-adjustment-test-002'
  }, makeResponse(), (error) => { forwardedError = error; });

  assert.equal(forwardedError?.statusCode, 400);
});
