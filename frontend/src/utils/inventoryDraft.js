export function ensureInventoryRequestKey(draft, createKey) {
  if (typeof draft?.idempotencyKey === 'string' && draft.idempotencyKey) return draft.idempotencyKey;
  const key = createKey();
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
    throw new Error('Inventory request key generation failed.');
  }
  return key;
}

export function updateInventoryDraft(draft, changes) {
  const changed = Object.keys(changes).some((field) => draft?.[field] !== changes[field]);
  return changed ? { ...draft, ...changes, idempotencyKey: undefined } : draft;
}

export function getInventoryRequestKey(target, delta, reason, storage, createKey) {
  if (typeof target !== 'string' || !target || !Number.isSafeInteger(delta) || delta === 0 || !reason.trim()) {
    throw new Error('Inventory request details are invalid.');
  }
  const storageKey = `yaqana:inventory-adjustment:${target}`;
  const fingerprint = JSON.stringify({ delta, reason: reason.trim() });
  const existing = storage.getItem(storageKey);
  if (existing) {
    const saved = JSON.parse(existing);
    if (saved.fingerprint === fingerprint) {
      return ensureInventoryRequestKey({ idempotencyKey: saved.key }, createKey);
    }
  }

  const idempotencyKey = ensureInventoryRequestKey({}, createKey);
  storage.setItem(storageKey, JSON.stringify({ fingerprint, key: idempotencyKey }));
  return idempotencyKey;
}

export function clearInventoryRequestKey(target, idempotencyKey, storage) {
  const storageKey = `yaqana:inventory-adjustment:${target}`;
  const existing = storage.getItem(storageKey);
  if (!existing) return false;
  const saved = JSON.parse(existing);
  if (saved.key !== idempotencyKey) return false;
  storage.removeItem(storageKey);
  return true;
}
