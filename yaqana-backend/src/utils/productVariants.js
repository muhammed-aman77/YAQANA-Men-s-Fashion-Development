const variantError = (message) => Object.assign(new Error(message), {
  statusCode: 400,
  code: 'INVALID_VARIANT_MATRIX'
});

const variantStatuses = new Set(['active', 'inactive', 'discontinued']);
export const isValidProductImageUrl = (value) => value.startsWith('https://') ||
  value.startsWith('http://') ||
  value.startsWith('/uploads/') ||
  value.startsWith('/images/');

export function findProductVariant(product, size, colour) {
  if (!Array.isArray(product?.variants)) return null;
  return product.variants.find((variant) =>
    String(variant.size || '').toLowerCase() === String(size || '').toLowerCase() &&
    String(variant.colour || '').toLowerCase() === String(colour || '').toLowerCase()
  ) || null;
}

export function getVariantStatus(product, size, colour) {
  const status = findProductVariant(product, size, colour)?.status;
  return status == null ? 'active' : status;
}

export function getVariantAvailability(product, size, colour) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variant = findProductVariant(product, size, colour);
  if (variants.length && !variant) return 0;

  const onHand = Number(variant ? variant.stock : product?.stock);
  const reserved = Number(variant?.reservedQuantity ?? 0);
  if (!Number.isSafeInteger(onHand) || onHand < 0 ||
    !Number.isSafeInteger(reserved) || reserved < 0 || reserved > onHand) {
    return 0;
  }
  return onHand - reserved;
}

export function getVariantPrice(product, size, colour) {
  const variant = findProductVariant(product, size, colour);
  const regularPricePaise = variant?.pricePaise ?? product?.pricePaise;
  const pricePaise = variant?.discountPricePaise ??
    variant?.pricePaise ??
    product?.discountPricePaise ??
    product?.pricePaise;
  return { pricePaise, originalPricePaise: regularPricePaise };
}

const normalizeVariantBarcode = (barcode) => {
  if (barcode === undefined || barcode === null || barcode === '') return undefined;
  if (typeof barcode !== 'string') throw variantError('Each barcode must be text.');
  const normalized = barcode.trim().toUpperCase();
  if (!normalized) return undefined;
  if (normalized.length > 128 || !/^[A-Z0-9][A-Z0-9._/-]{0,127}$/.test(normalized)) {
    throw variantError('Each barcode must contain valid barcode characters.');
  }
  return normalized;
};

const normalizeVariantImages = (images) => {
  if (images === undefined || images === null || images === '') return undefined;
  const values = typeof images === 'string' ? images.split(/\r?\n|,/) : images;
  if (!Array.isArray(values) || values.length > 30) {
    throw variantError('Variant images must be a valid list.');
  }
  const normalized = values.map((value) => typeof value === 'string' ? value.trim() : '');
  if (normalized.some((value) => !value || value.length > 2048 || !isValidProductImageUrl(value))) {
    throw variantError('Each variant image must use a supported image URL.');
  }
  return normalized;
};

const normalizeOptionalPrice = (value, label) => {
  if (value === undefined || value === null || value === '') return undefined;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw variantError(`${label} must be a non-negative whole number of paise.`);
  return amount;
};

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
  const seenBarcodes = new Set();
  const seenCombinations = new Set();

  return variants.map((variant) => {
    const size = sizeByKey.get(String(variant?.size || '').trim().toLowerCase());
    const colour = colourByKey.get(String(variant?.colour || '').trim().toLowerCase());
    if (!size || !colour) throw variantError('Each variant must match a configured size and colour.');

    const sku = typeof variant.sku === 'string' ? variant.sku.trim().toUpperCase() : '';
    if (!/^[A-Z0-9][A-Z0-9._-]{1,47}$/.test(sku)) throw variantError('Each variant needs a valid SKU.');
    if (seenSkus.has(sku)) throw variantError('Variant SKUs must be unique.');
    seenSkus.add(sku);

    const barcode = normalizeVariantBarcode(variant.barcode);
    if (barcode && seenBarcodes.has(barcode)) throw variantError('Variant barcodes must be unique.');
    if (barcode) seenBarcodes.add(barcode);

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

    const pricePaise = normalizeOptionalPrice(variant.pricePaise, 'Variant price');
    const discountPricePaise = normalizeOptionalPrice(variant.discountPricePaise, 'Variant sale price');
    if (pricePaise !== undefined && discountPricePaise !== undefined && discountPricePaise > pricePaise) {
      throw variantError('Variant sale price cannot exceed its regular price.');
    }

    const status = variant.status == null ? 'active' : String(variant.status).trim().toLowerCase();
    if (!variantStatuses.has(status)) throw variantError('Variant status is invalid.');

    let reorderTarget;
    if (variant.reorderTarget !== undefined && variant.reorderTarget !== null && variant.reorderTarget !== '') {
      reorderTarget = Number(variant.reorderTarget);
      if (!Number.isSafeInteger(reorderTarget) || reorderTarget < 0) {
        throw variantError('Reorder target must be a non-negative whole number.');
      }
    }

    const images = normalizeVariantImages(variant.images);
    const normalizedVariant = { size, colour, sku, stock, status };
    if (barcode) normalizedVariant.barcode = barcode;
    if (pricePaise !== undefined) normalizedVariant.pricePaise = pricePaise;
    if (discountPricePaise !== undefined) normalizedVariant.discountPricePaise = discountPricePaise;
    if (images !== undefined) normalizedVariant.images = images;
    if (reorderTarget !== undefined) normalizedVariant.reorderTarget = reorderTarget;
    return normalizedVariant;
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
