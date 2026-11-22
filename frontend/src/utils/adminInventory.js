export function getInventoryKpiFilter(label) {
  if (label === 'Low-stock SKUs') return { status: 'low_stock' };
  if (label === 'Out-of-stock SKUs') return { status: 'out_of_stock' };
  if (label === 'Incoming stock') return { status: 'all', incomingOnly: true };
  return null;
}

export function groupInventoryByColour(rows = []) {
  const sizeOrder = new Map(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'].map((size, index) => [size, index]));
  const groups = new Map();
  for (const row of rows) {
    const colour = String(row.colour || 'Unspecified').trim() || 'Unspecified';
    if (!groups.has(colour)) groups.set(colour, { colour, variants: [] });
    groups.get(colour).variants.push(row);
  }
  return [...groups.values()]
    .sort((left, right) => left.colour.localeCompare(right.colour))
    .map((group) => ({
      ...group,
      variants: [...group.variants].sort((left, right) => {
        const leftIndex = sizeOrder.get(String(left.size).toUpperCase());
        const rightIndex = sizeOrder.get(String(right.size).toUpperCase());
        if (leftIndex !== undefined || rightIndex !== undefined) {
          return (leftIndex ?? 999) - (rightIndex ?? 999);
        }
        return String(left.size).localeCompare(String(right.size));
      })
    }));
}

export function getQuickAdjustmentDelta(currentDelta, change) {
  const current = Number.isSafeInteger(currentDelta) ? currentDelta : 0;
  const next = current + change;
  return Number.isSafeInteger(next) ? next : current;
}

export function getInventoryDrawerState(item = {}) {
  return {
    title: String(item.productName || 'Inventory item'),
    identity: [item.colour, item.size].filter(Boolean).join(' · ') || 'Legacy stock',
    sku: String(item.sku || 'Legacy stock'),
    image: String(item.image || '')
  };
}

export function getInventoryVariantOptions(product = {}) {
  return (Array.isArray(product.variants) ? product.variants : [])
    .filter((variant) => String(variant.sku || '').trim())
    .map((variant) => ({
      value: String(variant.sku),
      label: [
        variant.colour || 'Unspecified colour',
        variant.size || 'Unspecified size',
        variant.sku,
        variant.status || 'active'
      ].join(' · ')
    }));
}

export function getInventoryReceiptTargetOptions(products = []) {
  return products.flatMap((product) => {
    const productId = String(product._id || product.id || '');
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length === 0) {
      return productId
        ? [{ value: productId, productId, sku: null, label: `${product.name || 'Product'} · Legacy stock` }]
        : [];
    }

    return variants
      .filter((variant) => String(variant.sku || '').trim())
      .map((variant) => ({
        value: String(variant.sku),
        productId,
        sku: String(variant.sku),
        label: [
          product.name || 'Product',
          variant.colour || 'Unspecified colour',
          variant.size || 'Unspecified size',
          variant.sku
        ].join(' · ')
      }));
  });
}
