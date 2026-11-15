export function buildStockMovementChange(product, variant, quantityDelta) {
  if (!Number.isSafeInteger(quantityDelta) || quantityDelta === 0) {
    throw new Error('A stock movement must contain a non-zero whole-number quantity.');
  }
  const stockBefore = variant?.stock ?? product.stock;
  const stockAfter = stockBefore + quantityDelta;
  if (!Number.isSafeInteger(stockBefore) || !Number.isSafeInteger(stockAfter) || stockAfter < 0) {
    throw new Error('A stock movement cannot result in invalid stock.');
  }
  return {
    product: String(product._id),
    productName: product.name,
    sku: variant?.sku || null,
    size: variant?.size || '',
    colour: variant?.colour || '',
    quantityDelta,
    stockBefore,
    stockAfter
  };
}

export function buildVariantStockAdjustment(sku, quantity, direction) {
  const normalizedSku = typeof sku === 'string' ? sku.trim().toUpperCase() : '';
  if (!normalizedSku) throw new Error('A variant SKU is required.');
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('A positive whole-number quantity is required.');
  if (direction === 'decrease') {
    return {
      filter: { sku: normalizedSku, stock: { $gte: quantity } },
      update: { $inc: { 'variants.$.stock': -quantity, stock: -quantity } }
    };
  }
  if (direction === 'increase') {
    return {
      filter: { sku: normalizedSku },
      update: { $inc: { 'variants.$.stock': quantity, stock: quantity } }
    };
  }
  throw new Error('Stock adjustment direction is invalid.');
}
