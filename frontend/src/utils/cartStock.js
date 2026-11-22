export function getCartQuantityError({
  currentQuantity = 0,
  addQuantity,
  desiredQuantity,
  availableStock,
  status = 'active'
}) {
  if (status !== 'active' || !Number.isSafeInteger(availableStock) || availableStock < 0) return 'UNAVAILABLE';
  const nextQuantity = desiredQuantity ?? currentQuantity + addQuantity;
  if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 1) return 'INVALID_QUANTITY';
  if (nextQuantity > availableStock) return 'STOCK_CHANGED';
  return null;
}
