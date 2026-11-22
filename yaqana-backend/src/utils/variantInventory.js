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

export function calculateStockAfterAdjustment(stockBefore, quantityDelta, reservedQuantity = 0) {
  if (!Number.isSafeInteger(quantityDelta) || quantityDelta === 0) {
    throw new Error('Adjustment quantity must be a non-zero whole number.');
  }
  if (!Number.isSafeInteger(stockBefore) || stockBefore < 0 ||
    !Number.isSafeInteger(reservedQuantity) || reservedQuantity < 0 || reservedQuantity > stockBefore) {
    throw new Error('On-hand or reserved stock quantity is invalid.');
  }
  const stockAfter = stockBefore + quantityDelta;
  if (!Number.isSafeInteger(stockAfter) || stockAfter < 0) {
    throw new Error('Adjustment would result in invalid on-hand stock.');
  }
  if (stockAfter < reservedQuantity) {
    throw new Error('Adjustment cannot reduce on-hand stock below reserved stock.');
  }
  return stockAfter;
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
