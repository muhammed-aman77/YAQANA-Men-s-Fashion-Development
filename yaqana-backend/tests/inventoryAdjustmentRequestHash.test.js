import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inventoryAdjustmentRequestHash } from '../src/controllers/inventoryController.js';

const adjustments = [{ sku: 'CORE-TEE-S', delta: -1 }];

test('default adjustment metadata preserves the existing idempotency hash', () => {
  const expected = JSON.stringify({ adjustments, reason: 'Stock correction' });
  const expectedHash = createHash('sha256').update(expected).digest('hex');
  assert.equal(
    inventoryAdjustmentRequestHash(adjustments, 'Stock correction'),
    expectedHash
  );
  assert.equal(
    inventoryAdjustmentRequestHash(adjustments, 'Stock correction', { type: 'manual', reference: '', notes: '' }),
    expectedHash
  );
});

test('audit metadata differentiates otherwise identical adjustment requests', () => {
  assert.notEqual(
    inventoryAdjustmentRequestHash(adjustments, 'Stock correction', { type: 'damaged', reference: 'COUNT-1', notes: '' }),
    inventoryAdjustmentRequestHash(adjustments, 'Stock correction', { type: 'lost', reference: 'COUNT-1', notes: '' })
  );
});

test('enhanced confirmation changes the idempotency identity', () => {
  const normal = inventoryAdjustmentRequestHash(adjustments, 'Stock correction', {
    type: 'manual',
    reference: '',
    notes: '',
    enhancedConfirmed: false
  });
  const confirmed = inventoryAdjustmentRequestHash(adjustments, 'Stock correction', {
    type: 'manual',
    reference: '',
    notes: '',
    enhancedConfirmed: true
  });

  assert.notEqual(normal, confirmed);
});

test('default policy metadata preserves idempotency hashes from existing clients', () => {
  const legacyHash = inventoryAdjustmentRequestHash(adjustments, 'Stock correction', {
    type: 'manual',
    reference: '',
    notes: ''
  });
  const currentDefaultHash = inventoryAdjustmentRequestHash(adjustments, 'Stock correction', {
    type: 'manual',
    reference: '',
    notes: '',
    enhancedConfirmed: false,
    approvalLevel: null
  });

  assert.equal(currentDefaultHash, legacyHash);
});
