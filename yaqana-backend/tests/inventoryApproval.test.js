import test from 'node:test';
import assert from 'node:assert/strict';
import InventoryPolicy from '../src/models/InventoryPolicy.js';
import Product from '../src/models/Product.js';
import StockMovement from '../src/models/StockMovement.js';
import AdminAudit from '../src/models/AdminAudit.js';

const loadApprovalModel = async () => {
  const module = await import('../src/models/InventoryApproval.js').catch(() => null);
  assert.ok(module, 'InventoryApproval model should be implemented');
  return module.default;
};

test('approval records retain the request, reviewer, and stock movement audit links', async () => {
  const InventoryApproval = await loadApprovalModel();
  const approval = new InventoryApproval({
    product: '507f1f77bcf86cd799439011',
    productName: 'Core Tee',
    sku: 'CORE-TEE-S',
    quantityDelta: -30,
    type: 'damaged',
    approvalLevel: 'admin',
    reason: 'Damaged units found',
    reference: 'COUNT-2026-11',
    notes: 'Recorded during a physical count.',
    status: 'pending',
    requestedBy: '507f1f77bcf86cd799439012',
    idempotencyKey: 'inventory-request-000001',
    requestHash: 'a'.repeat(64)
  });

  assert.equal(approval.validateSync(), undefined);
  assert.equal(approval.status, 'pending');
  assert.equal(approval.approvalLevel, 'admin');
  assert.equal(approval.requestedBy.toString(), '507f1f77bcf86cd799439012');
  assert.equal(approval.approvedBy, null);
  assert.equal(approval.reviewedBy, null);
  assert.equal(approval.movementId, null);
});

test('approval records reject unsupported approval levels and movement kinds', async () => {
  const InventoryApproval = await loadApprovalModel();
  const approval = new InventoryApproval({
    product: '507f1f77bcf86cd799439011',
    productName: 'Core Tee',
    sku: 'CORE-TEE-S',
    quantityDelta: 30,
    type: 'alien',
    approvalLevel: 'support_agent',
    reason: 'Count correction',
    requestedBy: '507f1f77bcf86cd799439012',
    idempotencyKey: 'inventory-request-000002',
    requestHash: 'b'.repeat(64)
  });

  const error = approval.validateSync();
  assert.equal(error?.errors.approvalLevel?.kind, 'enum');
  assert.equal(error?.errors.type?.kind, 'enum');
});

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

const invoke = async (handler, request, res = response()) => {
  let error;
  await handler(request, res, (nextError) => { error = nextError; });
  return { error, response: res };
};

test('medium stock adjustments require the explicit confirmation flag', async (t) => {
  const { adjustInventory } = await import('../src/controllers/inventoryController.js');
  const originals = {
    policyFindOne: InventoryPolicy.findOne,
    movementFindOne: StockMovement.findOne
  };
  InventoryPolicy.findOne = () => ({ lean: async () => null });
  StockMovement.findOne = () => { throw new Error('confirmation must be checked before stock persistence'); };
  t.after(() => {
    InventoryPolicy.findOne = originals.policyFindOne;
    StockMovement.findOne = originals.movementFindOne;
  });

  const result = await invoke(adjustInventory, {
    body: {
      adjustments: [{ sku: 'CORE-TEE-S', delta: 11 }],
      reason: 'Stock correction'
    },
    user: { _id: '507f1f77bcf86cd799439012' },
    get: () => 'inventory-medium-confirmation-01'
  });

  assert.equal(result.error?.statusCode, 400);
  assert.equal(result.error?.code, 'ENHANCED_CONFIRMATION_REQUIRED');
});

test('large adjustments create a pending request without changing stock', async (t) => {
  const [{ adjustInventory }, InventoryApproval] = await Promise.all([
    import('../src/controllers/inventoryController.js'),
    loadApprovalModel()
  ]);
  const originals = {
    policyFindOne: InventoryPolicy.findOne,
    productFindOne: Product.findOne,
    movementFindOne: StockMovement.findOne,
    movementCreate: StockMovement.create,
    approvalFindOne: InventoryApproval.findOne,
    approvalCreate: InventoryApproval.create
  };
  const product = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Core Tee',
    variants: [{ sku: 'CORE-TEE-S', size: 'S', colour: 'Black', stock: 8, reservedQuantity: 2 }]
  };
  const noExistingRequest = () => ({ select: async () => null });
  InventoryPolicy.findOne = () => ({ lean: async () => null });
  Product.findOne = () => ({ select() { return this; }, lean: async () => product });
  StockMovement.findOne = noExistingRequest;
  StockMovement.create = () => { throw new Error('pending approvals must not write stock movements'); };
  InventoryApproval.findOne = noExistingRequest;
  InventoryApproval.create = async (input) => new InventoryApproval(input);
  t.after(() => {
    InventoryPolicy.findOne = originals.policyFindOne;
    Product.findOne = originals.productFindOne;
    StockMovement.findOne = originals.movementFindOne;
    StockMovement.create = originals.movementCreate;
    InventoryApproval.findOne = originals.approvalFindOne;
    InventoryApproval.create = originals.approvalCreate;
  });

  const result = await invoke(adjustInventory, {
    body: {
      adjustments: [{ sku: 'CORE-TEE-S', delta: 30 }],
      reason: 'Count correction',
      type: 'correction'
    },
    user: { _id: '507f1f77bcf86cd799439012' },
    get: () => 'inventory-large-adjustment-0001'
  });

  assert.ifError(result.error);
  assert.equal(result.response.statusCode, 202);
  assert.equal(result.response.body.approval.status, 'pending');
  assert.equal(result.response.body.approval.approvalLevel, 'admin');
  assert.equal(product.variants[0].stock, 8);
});

test('Owner-level adjustments stay pending and cannot be decided by an Admin', async (t) => {
  const [{ adjustInventory }, { default: InventoryApproval }] = await Promise.all([
    import('../src/controllers/inventoryController.js'),
    import('../src/models/InventoryApproval.js')
  ]);
  const originals = {
    policyFindOne: InventoryPolicy.findOne,
    productFindOne: Product.findOne,
    movementFindOne: StockMovement.findOne,
    approvalFindOne: InventoryApproval.findOne,
    approvalCreate: InventoryApproval.create
  };
  const product = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Core Tee',
    variants: [{ sku: 'CORE-TEE-S', size: 'S', colour: 'Black', stock: 100, reservedQuantity: 2 }]
  };
  const noExistingRequest = () => ({ select: async () => null });
  InventoryPolicy.findOne = () => ({ lean: async () => null });
  Product.findOne = () => ({ select() { return this; }, lean: async () => product });
  StockMovement.findOne = noExistingRequest;
  InventoryApproval.findOne = noExistingRequest;
  InventoryApproval.create = async (input) => new InventoryApproval(input);
  t.after(() => {
    InventoryPolicy.findOne = originals.policyFindOne;
    Product.findOne = originals.productFindOne;
    StockMovement.findOne = originals.movementFindOne;
    InventoryApproval.findOne = originals.approvalFindOne;
    InventoryApproval.create = originals.approvalCreate;
  });

  const result = await invoke(adjustInventory, {
    body: {
      adjustments: [{ sku: 'CORE-TEE-S', delta: 51 }],
      reason: 'Large stock correction'
    },
    user: { _id: '507f1f77bcf86cd799439012' },
    get: () => 'inventory-owner-adjustment-001'
  });

  assert.ifError(result.error);
  assert.equal(result.response.statusCode, 202);
  assert.equal(result.response.body.approval.approvalLevel, 'owner');
  assert.equal(result.response.body.approval.status, 'pending');
  assert.equal(product.variants[0].stock, 100);
});

test('an adjustment cannot reduce stock below its reservation floor', async (t) => {
  const [{ adjustInventory }, { default: InventoryApproval }] = await Promise.all([
    import('../src/controllers/inventoryController.js'),
    import('../src/models/InventoryApproval.js')
  ]);
  const originals = {
    policyFindOne: InventoryPolicy.findOne,
    productFindOne: Product.findOne,
    movementFindOne: StockMovement.findOne,
    approvalFindOne: InventoryApproval.findOne,
    approvalCreate: InventoryApproval.create
  };
  const product = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Core Tee',
    variants: [{ sku: 'CORE-TEE-S', size: 'S', colour: 'Black', stock: 40, reservedQuantity: 20 }]
  };
  const noExistingRequest = () => ({ select: async () => null });
  InventoryPolicy.findOne = () => ({ lean: async () => null });
  Product.findOne = () => ({ select() { return this; }, lean: async () => product });
  StockMovement.findOne = noExistingRequest;
  InventoryApproval.findOne = noExistingRequest;
  InventoryApproval.create = () => { throw new Error('an invalid reserved-stock reduction must not be queued'); };
  t.after(() => {
    InventoryPolicy.findOne = originals.policyFindOne;
    Product.findOne = originals.productFindOne;
    StockMovement.findOne = originals.movementFindOne;
    InventoryApproval.findOne = originals.approvalFindOne;
    InventoryApproval.create = originals.approvalCreate;
  });

  const result = await invoke(adjustInventory, {
    body: {
      adjustments: [{ sku: 'CORE-TEE-S', delta: -30 }],
      reason: 'Large stock correction'
    },
    user: { _id: '507f1f77bcf86cd799439012' },
    get: () => 'inventory-reserved-adjustment-001'
  });

  assert.equal(result.error?.statusCode, 409);
  assert.match(result.error.message, /reserved stock/);
  assert.equal(product.variants[0].stock, 40);
});

test('an Admin cannot approve an Owner-level request', async (t) => {
  const controller = await import('../src/controllers/inventoryController.js');
  assert.equal(typeof controller.approveInventoryAdjustment, 'function');
  const { default: InventoryApproval } = await import('../src/models/InventoryApproval.js');
  const pending = new InventoryApproval({
    product: '507f1f77bcf86cd799439011',
    productName: 'Core Tee',
    sku: 'CORE-TEE-S',
    quantityDelta: 60,
    type: 'manual',
    approvalLevel: 'owner',
    reason: 'Large stock correction',
    requestedBy: '507f1f77bcf86cd799439012',
    idempotencyKey: 'inventory-request-owner-001',
    requestHash: 'c'.repeat(64)
  });
  const originalFindById = InventoryApproval.findById;
  InventoryApproval.findById = async () => pending;
  t.after(() => { InventoryApproval.findById = originalFindById; });

  let forwardedError;
  await controller.approveInventoryAdjustment({
    params: { id: String(pending._id) },
    user: { _id: '507f1f77bcf86cd799439013', role: 'admin' }
  }, response(), (error) => { forwardedError = error; });

  assert.equal(forwardedError?.statusCode, 403);
  assert.equal(pending.status, 'pending');
});

test('a requester cannot approve their own Admin-level request', async (t) => {
  const controller = await import('../src/controllers/inventoryController.js');
  assert.equal(typeof controller.approveInventoryAdjustment, 'function');
  const { default: InventoryApproval } = await import('../src/models/InventoryApproval.js');
  const requester = '507f1f77bcf86cd799439012';
  const pending = new InventoryApproval({
    product: '507f1f77bcf86cd799439011',
    productName: 'Core Tee',
    sku: 'CORE-TEE-S',
    quantityDelta: 30,
    type: 'manual',
    approvalLevel: 'admin',
    reason: 'Large stock correction',
    requestedBy: requester,
    idempotencyKey: 'inventory-request-admin-001',
    requestHash: 'd'.repeat(64)
  });
  const originalFindById = InventoryApproval.findById;
  InventoryApproval.findById = async () => pending;
  t.after(() => { InventoryApproval.findById = originalFindById; });

  const result = await invoke(controller.approveInventoryAdjustment, {
    params: { id: String(pending._id) },
    user: { _id: requester, role: 'admin' }
  });

  assert.equal(result.error?.statusCode, 403);
  assert.equal(pending.status, 'pending');
});

test('rejecting an Admin request records the reviewer without writing stock', async (t) => {
  const controller = await import('../src/controllers/inventoryController.js');
  assert.equal(typeof controller.rejectInventoryAdjustment, 'function');
  const { default: InventoryApproval } = await import('../src/models/InventoryApproval.js');
  const pending = new InventoryApproval({
    product: '507f1f77bcf86cd799439011',
    productName: 'Core Tee',
    sku: 'CORE-TEE-S',
    quantityDelta: 30,
    type: 'manual',
    approvalLevel: 'admin',
    reason: 'Large stock correction',
    requestedBy: '507f1f77bcf86cd799439012',
    idempotencyKey: 'inventory-request-reject-01',
    requestHash: 'e'.repeat(64)
  });
  const originals = {
    findById: InventoryApproval.findById,
    findOneAndUpdate: InventoryApproval.findOneAndUpdate,
    movementCreate: StockMovement.create,
    auditCreate: AdminAudit.create
  };
  const auditRecords = [];
  InventoryApproval.findById = async () => pending;
  InventoryApproval.findOneAndUpdate = async (_filter, update) => {
    Object.assign(pending, update.$set);
    return pending;
  };
  StockMovement.create = () => { throw new Error('reject must not write stock'); };
  AdminAudit.create = async (records) => { auditRecords.push(...(Array.isArray(records) ? records : [records])); return records; };
  t.after(() => {
    InventoryApproval.findById = originals.findById;
    InventoryApproval.findOneAndUpdate = originals.findOneAndUpdate;
    StockMovement.create = originals.movementCreate;
    AdminAudit.create = originals.auditCreate;
  });

  const result = await invoke(controller.rejectInventoryAdjustment, {
    params: { id: String(pending._id) },
    body: { reason: 'Rejected pending physical count evidence.' },
    user: { _id: '507f1f77bcf86cd799439013', role: 'admin' }
  });

  assert.ifError(result.error);
  assert.equal(result.response.body.approval.status, 'rejected');
  assert.equal(String(pending.reviewedBy), '507f1f77bcf86cd799439013');
  assert.ok(pending.reviewedAt instanceof Date);
  assert.equal(pending.rejectionReason, 'Rejected pending physical count evidence.');
  const completion = auditRecords.find(({ action }) => action === 'inventory.approval.reject');
  assert.equal(completion.actor, '507f1f77bcf86cd799439013');
  assert.deepEqual(completion.before, { status: 'pending' });
  assert.deepEqual(completion.after, { status: 'rejected' });
  assert.equal(completion.reason, 'Administrator rejected an inventory adjustment.');
  assert.equal(JSON.stringify(auditRecords).includes('Rejected pending physical count evidence.'), false);
  assert.equal(auditRecords[0].action, 'inventory.approval.reject.started');
});

test('inventory approval rejection does not mutate when audit intent cannot be recorded', async (t) => {
  const controller = await import('../src/controllers/inventoryController.js');
  const { default: InventoryApproval } = await import('../src/models/InventoryApproval.js');
  const pending = new InventoryApproval({
    product: '507f1f77bcf86cd799439011', productName: 'Core Tee', sku: 'CORE-TEE-S',
    quantityDelta: 30, type: 'manual', approvalLevel: 'admin', reason: 'Large stock correction',
    requestedBy: '507f1f77bcf86cd799439012', idempotencyKey: 'inventory-request-reject-audit-01', requestHash: '1'.repeat(64)
  });
  const originals = { findById: InventoryApproval.findById, update: InventoryApproval.findOneAndUpdate, audit: AdminAudit.create };
  let updateCalled = false;
  InventoryApproval.findById = async () => pending;
  InventoryApproval.findOneAndUpdate = async (_filter, update) => {
    updateCalled = true;
    Object.assign(pending, update.$set);
    return pending;
  };
  AdminAudit.create = async () => { throw new Error('audit storage unavailable'); };
  t.after(() => {
    InventoryApproval.findById = originals.findById;
    InventoryApproval.findOneAndUpdate = originals.update;
    AdminAudit.create = originals.audit;
  });

  const result = await invoke(controller.rejectInventoryAdjustment, {
    params: { id: String(pending._id) },
    body: { reason: 'Rejected pending physical count evidence.' },
    user: { _id: '507f1f77bcf86cd799439013', role: 'admin' }
  });

  assert.match(result.error?.message || '', /audit storage unavailable/);
  assert.equal(updateCalled, false);
  assert.equal(pending.status, 'pending');
});

test('inventory approval does not transition to approved when audit intent cannot be recorded', async (t) => {
  const controller = await import('../src/controllers/inventoryController.js');
  const { default: InventoryApproval } = await import('../src/models/InventoryApproval.js');
  const pending = new InventoryApproval({
    product: '507f1f77bcf86cd799439011', productName: 'Core Tee', sku: 'CORE-TEE-S',
    quantityDelta: 5, type: 'manual', approvalLevel: 'admin', reason: 'Small stock correction',
    requestedBy: '507f1f77bcf86cd799439012', idempotencyKey: 'inventory-request-approve-audit-01', requestHash: '2'.repeat(64)
  });
  const originals = { findById: InventoryApproval.findById, update: InventoryApproval.findOneAndUpdate, audit: AdminAudit.create };
  let updateCalled = false;
  InventoryApproval.findById = async () => pending;
  InventoryApproval.findOneAndUpdate = async (_filter, update) => {
    updateCalled = true;
    Object.assign(pending, update.$set);
    return pending;
  };
  AdminAudit.create = async () => { throw new Error('audit storage unavailable'); };
  t.after(() => {
    InventoryApproval.findById = originals.findById;
    InventoryApproval.findOneAndUpdate = originals.update;
    AdminAudit.create = originals.audit;
  });

  const result = await invoke(controller.approveInventoryAdjustment, {
    params: { id: String(pending._id) },
    user: { _id: '507f1f77bcf86cd799439013', role: 'admin' }
  });

  assert.match(result.error?.message || '', /audit storage unavailable/);
  assert.equal(updateCalled, false);
  assert.equal(pending.status, 'pending');
});

test('approval rejection reports completion-audit failure while retaining the intent event', async (t) => {
  const controller = await import('../src/controllers/inventoryController.js');
  const { default: InventoryApproval } = await import('../src/models/InventoryApproval.js');
  const pending = new InventoryApproval({
    product: '507f1f77bcf86cd799439011', productName: 'Core Tee', sku: 'CORE-TEE-S',
    quantityDelta: 30, type: 'manual', approvalLevel: 'admin', reason: 'Large stock correction',
    requestedBy: '507f1f77bcf86cd799439012', idempotencyKey: 'inventory-request-reject-audit-final-01', requestHash: '3'.repeat(64)
  });
  const originals = { findById: InventoryApproval.findById, update: InventoryApproval.findOneAndUpdate, audit: AdminAudit.create };
  const auditRecords = [];
  InventoryApproval.findById = async () => pending;
  InventoryApproval.findOneAndUpdate = async (_filter, update) => { Object.assign(pending, update.$set); return pending; };
  AdminAudit.create = async (record) => {
    if (auditRecords.length === 1) throw new Error('audit completion unavailable');
    auditRecords.push(record);
  };
  t.after(() => {
    InventoryApproval.findById = originals.findById;
    InventoryApproval.findOneAndUpdate = originals.update;
    AdminAudit.create = originals.audit;
  });

  const result = await invoke(controller.rejectInventoryAdjustment, {
    params: { id: String(pending._id) },
    body: { reason: 'Rejected pending physical count evidence.' },
    user: { _id: '507f1f77bcf86cd799439013', role: 'admin' }
  });

  assert.match(result.error?.message || '', /audit completion unavailable/);
  assert.equal(pending.status, 'rejected');
  assert.equal(auditRecords.length, 1);
  assert.equal(auditRecords[0].action, 'inventory.approval.reject.started');
});

test('repeating approval of an applied request does not reapply stock', async (t) => {
  const controller = await import('../src/controllers/inventoryController.js');
  assert.equal(typeof controller.approveInventoryAdjustment, 'function');
  const { default: InventoryApproval } = await import('../src/models/InventoryApproval.js');
  const applied = new InventoryApproval({
    product: '507f1f77bcf86cd799439011',
    productName: 'Core Tee',
    sku: 'CORE-TEE-S',
    quantityDelta: 30,
    type: 'manual',
    approvalLevel: 'admin',
    reason: 'Large stock correction',
    status: 'applied',
    requestedBy: '507f1f77bcf86cd799439012',
    approvedBy: '507f1f77bcf86cd799439013',
    idempotencyKey: 'inventory-request-applied-01',
    requestHash: 'f'.repeat(64)
  });
  const originals = {
    findById: InventoryApproval.findById,
    movementFindOne: StockMovement.findOne
  };
  InventoryApproval.findById = async () => applied;
  StockMovement.findOne = () => { throw new Error('applied approvals must not be re-applied'); };
  t.after(() => {
    InventoryApproval.findById = originals.findById;
    StockMovement.findOne = originals.movementFindOne;
  });

  const result = await invoke(controller.approveInventoryAdjustment, {
    params: { id: String(applied._id) },
    user: { _id: '507f1f77bcf86cd799439014', role: 'admin' }
  });

  assert.ifError(result.error);
  assert.equal(result.response.body.approval.status, 'applied');
});
