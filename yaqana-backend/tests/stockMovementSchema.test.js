import test from 'node:test';
import assert from 'node:assert/strict';
import StockMovement from '../src/models/StockMovement.js';

test('stock movement supports auditable adjustment kinds, external references, and notes', () => {
  const movement = new StockMovement({
    changes: [{
      product: '507f1f77bcf86cd799439011',
      productName: 'Core Tee',
      sku: 'CORE-TEE-S',
      quantityDelta: -1,
      stockBefore: 4,
      stockAfter: 3
    }],
    reason: 'One item damaged',
    type: 'damaged',
    enhancedConfirmed: true,
    reference: 'COUNT-2026-11',
    notes: 'Removed during stock inspection.',
    performedBy: '507f1f77bcf86cd799439012'
  });

  assert.equal(movement.validateSync(), undefined);
  assert.equal(movement.reference, 'COUNT-2026-11');
  assert.equal(movement.notes, 'Removed during stock inspection.');
  assert.equal(movement.enhancedConfirmed, true);
});
