const slugPart = (value, limit) => String(value)
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, limit) || 'ITEM';

const combinationKey = (size, colour) => `${size.toLowerCase()}\u0000${colour.toLowerCase()}`;

export function buildVariantMatrix({ productName, sizes, colours, existingVariants = [], createSuffix }) {
  if (!Array.isArray(sizes) || !Array.isArray(colours) || !Array.isArray(existingVariants)) {
    throw new TypeError('Sizes, colours and existing variants must be lists.');
  }
  const existingByCombination = new Map(
    existingVariants.map((variant) => [combinationKey(variant.size, variant.colour), variant])
  );
  const generateSuffix = createSuffix || (() => {
    if (!globalThis.crypto?.randomUUID) throw new Error('Secure SKU generation is unavailable in this browser.');
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  });

  return sizes.flatMap((size) => colours.map((colour) => {
    const existing = existingByCombination.get(combinationKey(size, colour));
    if (existing) return { size, colour, sku: existing.sku, stock: existing.stock };
    const suffix = String(generateSuffix()).replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase();
    if (suffix.length !== 8) throw new Error('Secure SKU generation returned an invalid identifier.');
    return {
      size,
      colour,
      sku: `YQ-${slugPart(productName, 12)}-${slugPart(colour, 8)}-${slugPart(size, 6)}-${suffix}`,
      stock: 0
    };
  }));
}

export function getProductVariant(product, size, colour) {
  if (!Array.isArray(product?.variants)) return null;
  return product.variants.find((variant) =>
    String(variant.size || '').toLowerCase() === String(size || '').toLowerCase() &&
    String(variant.colour || '').toLowerCase() === String(colour || '').toLowerCase()
  ) || null;
}

export function getVariantStock(product, size, colour) {
  if (Array.isArray(product?.variants) && product.variants.length > 0) {
    return getProductVariant(product, size, colour)?.stock ?? 0;
  }
  return product?.stock ?? 0;
}

export function getColourGallery(product, colour) {
  const selectedColour = product?.colours?.find((entry) =>
    String(entry.name || '').toLowerCase() === String(colour || '').toLowerCase()
  );
  return selectedColour?.images?.length ? selectedColour.images : (product?.images || []);
}
