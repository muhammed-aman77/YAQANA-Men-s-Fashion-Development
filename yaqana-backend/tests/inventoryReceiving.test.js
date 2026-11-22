import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateWeightedAverageCost,
  getInboundRemaining,
  normalizeInboundDraft,
  normalizeInboundReceipt
} from '../src/utils/inventoryReceiving.js';
import { receiveInventoryInbound } from '../src/services/inventoryReceivingService.js';
import InventoryInbound from '../src/models/InventoryInbound.js';
import Product from '../src/models/Product.js';
import { createInventoryInbound } from '../src/controllers/inventoryController.js';

const productId = '507f1f77bcf86cd799439011';

test('inbound draft validation normalizes expected quantities, dates, reference, and verified cost', () => {
  const expectedDate = '2026-12-01T00:00:00.000Z';
  assert.deepEqual(normalizeInboundDraft({
    productId,
    sku: ' core-tee-s ',
    expectedDate,
    expectedQuantity: 12,
    reference: ' PO-42 ',
    unitCostPaise: 1250
  }), {
    productId,
    sku: 'CORE-TEE-S',
    expectedDate: new Date(expectedDate),
    expectedQuantity: 12,
    reference: 'PO-42',
    unitCostPaise: 1250
  });
});

test('inbound draft rejects invalid targets, quantities, dates, and purchase costs', () => {
  assert.throws(() => normalizeInboundDraft({ productId: 'invalid', expectedQuantity: 1 }), /product/i);
  assert.throws(() => normalizeInboundDraft({ productId, expectedQuantity: 0 }), /expected quantity/i);
  assert.throws(() => normalizeInboundDraft({ productId, expectedQuantity: 1, expectedDate: 'invalid' }), /date/i);
  assert.throws(() => normalizeInboundDraft({ productId, expectedQuantity: 1, unitCostPaise: -1 }), /cost/i);
});

test('partial receipts account for accepted, damaged, rejected, and cancelled units', () => {
  const receipt = {
    expectedQuantity: 12,
    receivedQuantity: 3,
    damagedQuantity: 1,
    rejectedQuantity: 2,
    cancelledQuantity: 1,
    status: 'open'
  };
  assert.equal(getInboundRemaining(receipt), 5);
  assert.deepEqual(normalizeInboundReceipt({ receivedQuantity: 2, damagedQuantity: 1 }, 5), {
    receivedQuantity: 2,
    damagedQuantity: 1,
    rejectedQuantity: 0,
    cancelledQuantity: 0,
    unitCostPaise: null,
    cancellationReason: ''
  });
  assert.throws(() => normalizeInboundReceipt({ receivedQuantity: 4, rejectedQuantity: 2 }, 5), /remaining/i);
  assert.throws(() => normalizeInboundReceipt({ receivedQuantity: 0 }, 5), /at least one/i);
  assert.throws(() => normalizeInboundReceipt({ cancelledQuantity: 1 }, 5), /cancellation reason/i);
  assert.deepEqual(normalizeInboundReceipt({
    cancelledQuantity: 1,
    cancellationReason: 'Supplier cancelled the balance.'
  }, 5).cancelledQuantity, 1);
});

test('receipt cost updates only when all existing units have verified cost coverage', () => {
  assert.deepEqual(calculateWeightedAverageCost({
    onHand: 10,
    costedQuantity: 10,
    unitCostPaise: 1000
  }, 5, 1300), {
    unitCostPaise: 1100,
    costedQuantity: 15
  });
  assert.deepEqual(calculateWeightedAverageCost({
    onHand: 10,
    costedQuantity: 7,
    unitCostPaise: 1000
  }, 5, 1300), {
    unitCostPaise: 1000,
    costedQuantity: 7
  });
  assert.deepEqual(calculateWeightedAverageCost({
    onHand: 0,
    costedQuantity: 0,
    unitCostPaise: null
  }, 5, null), {
    unitCostPaise: null,
    costedQuantity: 0
  });
});

test('stock receiving fails closed before touching data when transactions are unavailable', async () => {
  await assert.rejects(receiveInventoryInbound({
    receiptId: productId,
    idempotencyKey: 'receipt-request-000001',
    input: { receivedQuantity: 1 },
    performedBy: productId
  }), (error) => error.statusCode === 503 && error.code === 'TRANSACTIONS_REQUIRED');
});

test('create inbound API validates a SKU target and persists a request-idempotent receipt', async (t) => {
  const originals = {
    inboundFindOne: InventoryInbound.findOne,
    inboundCreate: InventoryInbound.create,
    productFindById: Product.findById
  };
  const receipt = {
    _id: '507f1f77bcf86cd799439013',
    expectedQuantity: 4,
    status: 'open'
  };
  InventoryInbound.findOne = () => ({ select: async () => null });
  InventoryInbound.create = async (documents) => {
    Object.assign(receipt, documents[0]);
    return [receipt];
  };
  Product.findById = () => ({
    select() { return this; },
    lean: async () => ({ name: 'Core Tee', variants: [{ sku: 'CORE-TEE-S' }] })
  });
  t.after(() => {
    InventoryInbound.findOne = originals.inboundFindOne;
    InventoryInbound.create = originals.inboundCreate;
    Product.findById = originals.productFindById;
  });

  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let forwardedError;
  await createInventoryInbound({
    body: { productId, sku: 'core-tee-s', expectedQuantity: 4, reference: ' PO-42 ' },
    user: { _id: '507f1f77bcf86cd799439012' },
    get: () => 'receipt-create-request-0001'
  }, response, (error) => { forwardedError = error; });

  assert.ifError(forwardedError);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.receipt.sku, 'CORE-TEE-S');
  assert.equal(response.body.receipt.reference, 'PO-42');
  assert.equal(response.body.receipt.status, 'open');
});
