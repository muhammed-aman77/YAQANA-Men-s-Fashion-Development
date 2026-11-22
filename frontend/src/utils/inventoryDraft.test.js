import test from 'node:test';
import assert from 'node:assert/strict';

test('an inventory retry keeps its request key until the adjustment inputs change', async () => {
  const { ensureInventoryRequestKey, updateInventoryDraft } = await import('./inventoryDraft.js').catch(() => ({}));
  const draft = { delta: '-2', reason: 'Correct count', idempotencyKey: 'inventory-request-key-001' };

  assert.equal(ensureInventoryRequestKey?.(draft, () => 'unused-request-key-001'), draft.idempotencyKey);
  assert.equal(updateInventoryDraft?.(draft, { reason: 'Damaged units' }).idempotencyKey, undefined);
});

test('an unchanged adjustment reuses its key after a page reload but a successful attempt can be cleared', async () => {
  const { clearInventoryRequestKey, getInventoryRequestKey } = await import('./inventoryDraft.js').catch(() => ({}));
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  let generated = 0;
  const createKey = () => `inventory-request-${String(++generated).padStart(16, '0')}`;

  const firstKey = getInventoryRequestKey?.('YQ-TEE-BLACK-S', -2, 'Correct count', storage, createKey);
  const retryKey = getInventoryRequestKey?.('YQ-TEE-BLACK-S', -2, 'Correct count', storage, createKey);
  const changedRequestKey = getInventoryRequestKey?.('YQ-TEE-BLACK-S', -1, 'Correct count', storage, createKey);

  assert.equal(firstKey, retryKey);
  assert.notEqual(changedRequestKey, firstKey);
  clearInventoryRequestKey?.('YQ-TEE-BLACK-S', changedRequestKey, storage);
  assert.notEqual(getInventoryRequestKey?.('YQ-TEE-BLACK-S', -1, 'Correct count', storage, createKey), changedRequestKey);
});

test('inventory confirmation follows configured normal and enhanced thresholds', async () => {
  const { requiresEnhancedInventoryConfirmation, isInventoryPolicyValid } = await import('./inventoryDraft.js');
  const policy = { normalAdjustmentLimit: 4, enhancedConfirmationLimit: 8, adminApprovalLimit: 12 };

  assert.equal(isInventoryPolicyValid(policy), true);
  assert.equal(requiresEnhancedInventoryConfirmation(4, policy), false);
  assert.equal(requiresEnhancedInventoryConfirmation(-5, policy), true);
  assert.equal(requiresEnhancedInventoryConfirmation(8, policy), true);
  assert.equal(requiresEnhancedInventoryConfirmation(-9, policy), false);
  assert.equal(requiresEnhancedInventoryConfirmation(1.5, policy), false);
});

test('inventory confirmation policy fails closed when absent or invalid', async () => {
  const { requiresEnhancedInventoryConfirmation, isInventoryPolicyValid } = await import('./inventoryDraft.js');
  assert.equal(isInventoryPolicyValid(null), false);
  assert.equal(isInventoryPolicyValid({ normalAdjustmentLimit: 5, enhancedConfirmationLimit: 4, adminApprovalLimit: 8 }), false);
  assert.equal(requiresEnhancedInventoryConfirmation(5, null), false);
});
