import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COD_STATES,
  canTransitionCod,
  normalizeShipment,
  validateRefundRequest
} from '../src/utils/orderOperations.js';

test('COD lifecycle distinguishes confirmation, collection, failure and cancellation', () => {
  assert.deepEqual(COD_STATES, ['Pending', 'Confirmed', 'Collected', 'Failed', 'Cancelled']);
  assert.equal(canTransitionCod('Pending', 'Confirmed'), true);
  assert.equal(canTransitionCod('Confirmed', 'Collected'), true);
  assert.equal(canTransitionCod('Collected', 'Failed'), false);
  assert.equal(canTransitionCod('Confirmed', 'Cancelled'), true);
});

test('shipment normalization requires carrier and tracked reference', () => {
  assert.throws(() => normalizeShipment({ carrier: '', trackingNumber: '', shippedAt: new Date().toISOString() }), /carrier/i);
  assert.deepEqual(normalizeShipment({
    carrier: '  Blue Dart ',
    trackingNumber: '  BD-123 ',
    shippedAt: '2026-11-21T12:00:00.000Z'
  }), {
    carrier: 'Blue Dart',
    trackingNumber: 'BD-123',
    shippedAt: new Date('2026-11-21T12:00:00.000Z')
  });
});

test('refund requests are bounded and require verified evidence', () => {
  assert.throws(() => validateRefundRequest({ amountPaise: 0, evidence: '' }), /amount/i);
  assert.throws(() => validateRefundRequest({ amountPaise: 100, evidence: '' }), /evidence/i);
  assert.deepEqual(validateRefundRequest({
    amountPaise: 5000,
    evidence: 'Gateway refund confirmation RFD-123',
    reason: 'Customer returned item'
  }), {
    amountPaise: 5000,
    evidence: 'Gateway refund confirmation RFD-123',
    reason: 'Customer returned item'
  });
});
