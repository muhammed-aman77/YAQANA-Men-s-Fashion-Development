export function buildColourSkuGroups(variants = []) {
  const groups = new Map();
  for (const variant of variants) {
    const colour = String(variant.colour || 'Unspecified').trim() || 'Unspecified';
    if (!groups.has(colour)) groups.set(colour, { colour, variants: [] });
    groups.get(colour).variants.push({
      ...variant,
      size: String(variant.size || '').trim(),
      sku: String(variant.sku || '').trim().toUpperCase(),
      status: variant.status || 'active'
    });
  }
  const sizeOrder = new Map(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'].map((size, index) => [size, index]));
  return [...groups.values()]
    .sort((left, right) => left.colour.localeCompare(right.colour))
    .map((group) => ({
      ...group,
      variants: group.variants.sort((left, right) => {
        const leftIndex = sizeOrder.get(String(left.size).toUpperCase());
        const rightIndex = sizeOrder.get(String(right.size).toUpperCase());
        if (leftIndex !== undefined || rightIndex !== undefined) {
          return (leftIndex ?? 999) - (rightIndex ?? 999);
        }
        return left.size.localeCompare(right.size);
      }),
      activeSellableSkuCount: group.variants.filter((variant) =>
        variant.status === 'active' &&
        /^[A-Z0-9][A-Z0-9._-]{1,47}$/.test(String(variant.sku)) &&
        Number.isSafeInteger(Number(variant.stock)) &&
        Number.isSafeInteger(Number(variant.reservedQuantity || 0)) &&
        Number(variant.reservedQuantity || 0) >= 0 &&
        Number(variant.stock) > Number(variant.reservedQuantity || 0)
      ).length
    }));
}

export function buildLegacyAllocationPreview({
  productName = '',
  originalStock,
  availableSkus = [],
  allocations = []
} = {}) {
  if (!Number.isSafeInteger(originalStock) || originalStock < 0) throw new Error('Original physical stock must be non-negative.');
  const seen = new Set();
  const allowedSkus = new Set(availableSkus.map((sku) => String(sku).trim().toUpperCase()));
  let allocatedQuantity = 0;
  const normalized = allocations.map((allocation) => {
    const sku = String(allocation.sku || '').trim().toUpperCase();
    const quantity = Number(allocation.quantity);
    if (!sku) throw new Error('Every allocation requires an exact variant SKU.');
    if (!allowedSkus.has(sku)) throw new Error(`SKU ${sku} does not belong to this product.`);
    if (!Number.isSafeInteger(quantity)) throw new Error('Allocated quantity must be a whole number.');
    if (quantity < 0) throw new Error('Negative legacy-stock allocation is not allowed.');
    if (seen.has(sku)) throw new Error('Duplicate SKU allocation is not allowed.');
    seen.add(sku);
    allocatedQuantity += quantity;
    return { sku, quantity };
  });
  if (allocatedQuantity > originalStock) throw new Error('Allocated quantity cannot exceed original physical stock.');
  const unallocatedQuantity = originalStock - allocatedQuantity;
  return {
    productName,
    originalStock,
    allocatedQuantity,
    unallocatedQuantity,
    allocations: normalized,
    reconciles: allocatedQuantity + unallocatedQuantity === originalStock,
    status: 'review'
  };
}

export function normalizeVerifiedUnitCost(value) {
  const rupees = Number(value);
  if (!Number.isFinite(rupees) || rupees < 0) throw new Error('Verified unit cost must be a non-negative amount.');
  const paise = Math.round(rupees * 100);
  if (!Number.isSafeInteger(paise)) throw new Error('Verified unit cost is too large.');
  return paise;
}

export function previewStocktake({ recordedQuantity, countedQuantity } = {}) {
  if (!Number.isSafeInteger(recordedQuantity) || recordedQuantity < 0) throw new Error('Recorded quantity must be non-negative.');
  if (!Number.isSafeInteger(countedQuantity) || countedQuantity < 0) throw new Error('Counted quantity must be non-negative.');
  return {
    recordedQuantity,
    countedQuantity,
    variance: countedQuantity - recordedQuantity,
    requiresConfirmation: true
  };
}

export function previewInventoryCsv({ csvText = '', availableSkus = [] } = {}) {
  const lines = String(csvText).replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { validRows: 0, invalidRows: 0, duplicates: 0, rows: [], errors: ['CSV is empty'] };
  const headers = lines.shift().split(',').map((header) => header.trim().toUpperCase());
  const skuIndex = headers.indexOf('SKU');
  const quantityIndex = headers.indexOf('QUANTITY');
  if (skuIndex < 0 || quantityIndex < 0) {
    return { validRows: 0, invalidRows: 0, duplicates: 0, rows: [], errors: ['CSV must include SKU and Quantity columns'] };
  }
  const allowed = new Set(availableSkus.map((sku) => String(sku).trim().toUpperCase()));
  const seen = new Set();
  let validRows = 0;
  let invalidRows = 0;
  let duplicates = 0;
  const rows = [];
  const errors = [];
  lines.forEach((line, index) => {
    const columns = line.split(',').map((column) => column.trim());
    const sku = String(columns[skuIndex] || '').trim().toUpperCase();
    const quantity = Number(columns[quantityIndex]);
    if (seen.has(sku)) {
      duplicates += 1;
      invalidRows += 1;
      errors.push(`Row ${index + 2}: duplicate SKU ${sku}`);
      return;
    }
    seen.add(sku);
    if (!allowed.has(sku)) {
      invalidRows += 1;
      errors.push(`Row ${index + 2}: unknown SKU ${sku || '(missing)'}`);
      return;
    }
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      invalidRows += 1;
      errors.push(`Row ${index + 2}: quantity must be non-negative`);
      return;
    }
    validRows += 1;
    rows.push({ sku, quantity, reason: columns[headers.indexOf('REASON')] || '', rowNumber: index + 2 });
  });
  return { validRows, invalidRows, duplicates, rows, errors };
}
