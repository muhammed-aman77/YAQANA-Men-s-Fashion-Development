const variantError = (message) => Object.assign(new Error(message), {
  statusCode: 400,
  code: 'INVALID_VARIANT_MATRIX'
});

export function findProductVariant(product, size, colour) {
  if (!Array.isArray(product?.variants)) return null;
  return product.variants.find((variant) =>
    String(variant.size || '').toLowerCase() === String(size || '').toLowerCase() &&
    String(variant.colour || '').toLowerCase() === String(colour || '').toLowerCase()
  ) || null;
}

export function validateVariantMatrix(sizes, colours, variants) {
  if (!Array.isArray(sizes) || !Array.isArray(colours) || !Array.isArray(variants)) {
    throw variantError('Sizes, colours and variants must be lists.');
  }
  if (variants.length === 0) return [];

  const sizeByKey = new Map();
  for (const size of sizes) {
    if (typeof size !== 'string' || !size.trim()) throw variantError('Each size must have a name.');
    const key = size.trim().toLowerCase();
    if (sizeByKey.has(key)) throw variantError('Sizes must be unique.');
    sizeByKey.set(key, size.trim());
  }

  const colourByKey = new Map();
  for (const colour of colours) {
    if (typeof colour?.name !== 'string' || !colour.name.trim()) throw variantError('Each colour must have a name.');
    const key = colour.name.trim().toLowerCase();
    if (colourByKey.has(key)) throw variantError('Colours must be unique.');
    colourByKey.set(key, colour.name.trim());
  }

  if (sizes.length * colours.length !== variants.length) {
    throw variantError('Variants must include the complete size and colour matrix.');
  }

  const seenSkus = new Set();
  const seenCombinations = new Set();

  return variants.map((variant) => {
    const size = sizeByKey.get(String(variant?.size || '').trim().toLowerCase());
    const colour = colourByKey.get(String(variant?.colour || '').trim().toLowerCase());
    if (!size || !colour) throw variantError('Each variant must match a configured size and colour.');

    const sku = typeof variant.sku === 'string' ? variant.sku.trim().toUpperCase() : '';
    if (!/^[A-Z0-9][A-Z0-9._-]{1,47}$/.test(sku)) throw variantError('Each variant needs a valid SKU.');
    if (seenSkus.has(sku)) throw variantError('Variant SKUs must be unique.');
    seenSkus.add(sku);

    const combination = `${size.toLowerCase()}\u0000${colour.toLowerCase()}`;
    if (seenCombinations.has(combination)) throw variantError('Each size and colour combination must be unique.');
    seenCombinations.add(combination);

    if (variant.stock === '' || variant.stock === null || variant.stock === undefined) {
      throw variantError('Variant stock must be a non-negative whole number.');
    }
    const stock = Number(variant.stock);
    if (!Number.isSafeInteger(stock) || stock < 0) {
      throw variantError('Variant stock must be a non-negative whole number.');
    }

    return { size, colour, sku, stock };
  });
}

export function assertVariantInventoryUnchanged(currentVariants, nextVariants) {
  const combinationKey = ({ size, colour }) => `${size.toLowerCase()}\u0000${colour.toLowerCase()}`;
  const nextByCombination = new Map(nextVariants.map((variant) => [combinationKey(variant), variant]));

  for (const current of currentVariants) {
    const next = nextByCombination.get(combinationKey(current));
    if (!next) {
      if (current.stock > 0) throw variantError('Stocked variants cannot be removed before inventory is adjusted to zero.');
      continue;
    }
    if (next.sku !== current.sku || next.stock !== current.stock) {
      throw variantError('Variant stock and existing SKUs must be changed through inventory adjustments.');
    }
  }

  const currentCombinations = new Set(currentVariants.map(combinationKey));
  for (const next of nextVariants) {
    if (!currentCombinations.has(combinationKey(next)) && next.stock !== 0) {
      throw variantError('New variants must start at zero stock and be received through inventory adjustments.');
    }
  }
}
