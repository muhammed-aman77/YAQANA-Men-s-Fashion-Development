import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInventoryAdjustments } from '../src/utils/inventoryAdjustments.js';

test('normalizes a bulk SKU adjustment batch without losing per-item quantities', () => {
  assert.deepEqual(normalizeInventoryAdjustments([
    { sku: 'yaq-tee-blk-s', delta: 5 },
    { sku: 'YAQ-TEE-BLK-M', delta: -2 }
  ]), [
    { sku: 'YAQ-TEE-BLK-S', productId: null, delta: 5 },
    { sku: 'YAQ-TEE-BLK-M', productId: null, delta: -2 }
  ]);
});

test('rejects duplicate targets, zero quantities, and batches over the supported limit', () => {
  assert.throws(() => normalizeInventoryAdjustments([
    { sku: 'YAQ-TEE-BLK-S', delta: 1 },
    { sku: 'yaq-tee-blk-s', delta: 2 }
  ]), /only once/);
  assert.throws(() => normalizeInventoryAdjustments([{ sku: 'YAQ-TEE-BLK-S', delta: 0 }]), /non-zero whole number/);
  assert.throws(() => normalizeInventoryAdjustments(Array.from({ length: 101 }, (_, index) => ({
    sku: `SKU-${index}`,
    delta: 1
  }))), /100 inventory adjustments/);
});

test('supports aggregate legacy product adjustments without requiring a SKU', () => {
  assert.deepEqual(normalizeInventoryAdjustments([
    { productId: '507f1f77bcf86cd799439011', delta: -3 }
  ]), [
    { sku: null, productId: '507f1f77bcf86cd799439011', delta: -3 }
  ]);
});
