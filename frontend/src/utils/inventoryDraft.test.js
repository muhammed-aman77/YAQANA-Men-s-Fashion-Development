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
