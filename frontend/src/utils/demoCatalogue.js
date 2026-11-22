function findVariant(product, size, colour) {
  if (!Array.isArray(product?.variants)) return null;
  return product.variants.find((variant) =>
    String(variant.size || '').toLowerCase() === String(size || '').toLowerCase() &&
    String(variant.colour || '').toLowerCase() === String(colour || '').toLowerCase()
  ) || null;
}

export function getDemoSizesForColour(product, colour) {
  if (!product?.isDemoData || !Array.isArray(product.variants)) {
    return Array.isArray(product?.sizes) ? product.sizes : [];
  }
  const sizes = product.variants
    .filter((variant) => String(variant.colour || '').toLowerCase() === String(colour || '').toLowerCase())
    .map((variant) => variant.size)
    .filter(Boolean);
  return [...new Set(sizes)];
}

export function isDemoVariantSelectable(product, colour, size) {
  if (!product?.isDemoData) return true;
  const variant = findVariant(product, size, colour);
  if (!variant) return false;
  if (variant.status && variant.status !== 'active') return false;
  const stock = Number(variant.stock);
  const reserved = Number(variant.reservedQuantity || 0);
  return Number.isSafeInteger(stock) && stock >= 0 &&
    Number.isSafeInteger(reserved) && reserved >= 0 &&
    reserved <= stock && stock - reserved > 0;
}

export function getDemoVariantAvailabilityText(product, colour, size) {
  if (!product?.isDemoData) return '';
  const variant = findVariant(product, size, colour);
  if (!variant) return 'Unavailable';
  if (variant.status && variant.status !== 'active') return 'Unavailable';
  const stock = Number(variant.stock);
  const reserved = Number(variant.reservedQuantity || 0);
  if (!Number.isSafeInteger(stock) || stock < 0 ||
      !Number.isSafeInteger(reserved) || reserved < 0 || reserved > stock) {
    return 'Unavailable';
  }
  const available = stock - reserved;
  if (available <= 0) return 'Out of stock';
  return `${available} available`;
}
