const adjustmentError = (message) => Object.assign(new Error(message), {
  statusCode: 400,
  code: 'INVALID_INVENTORY_ADJUSTMENT'
});

export function normalizeInventoryAdjustments(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) {
    throw adjustmentError('Provide between 1 and 100 inventory adjustments.');
  }

  const targets = new Set();
  return input.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw adjustmentError('Each inventory adjustment must be an object.');
    }

    const sku = typeof entry.sku === 'string' ? entry.sku.trim().toUpperCase() : '';
    const productId = typeof entry.productId === 'string' ? entry.productId.trim() : '';
    if (Boolean(sku) === Boolean(productId)) throw adjustmentError('Provide exactly one SKU or product ID for each adjustment.');
    if (sku && !/^[A-Z0-9][A-Z0-9._-]{1,47}$/.test(sku)) throw adjustmentError('An inventory adjustment contains an invalid SKU.');
    if (productId && !/^[a-f\d]{24}$/i.test(productId)) throw adjustmentError('An inventory adjustment contains an invalid product ID.');

    const delta = Number(entry.delta);
    if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 100000) {
      throw adjustmentError('Adjustment quantity must be a non-zero whole number of 100,000 units or less.');
    }

    const target = sku ? `sku:${sku}` : `product:${productId}`;
    if (targets.has(target)) throw adjustmentError('Each inventory target may appear only once per batch.');
    targets.add(target);
    return { sku: sku || null, productId: productId || null, delta };
  });
}
