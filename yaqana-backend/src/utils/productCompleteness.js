export function getProductCompletenessIssues(product) {
  const missing = [];
  if (String(product?.name || '').trim().length < 2) missing.push('product name');
  if (!String(product?.description || '').trim()) missing.push('description');
  if (!String(product?.category || '').trim()) missing.push('category');
  if (!Number.isSafeInteger(Number(product?.pricePaise)) || Number(product.pricePaise) <= 0) missing.push('price above zero');
  if (!Array.isArray(product?.images) || product.images.length === 0) missing.push('at least one product image');
  if (!Array.isArray(product?.sizes) || product.sizes.length === 0) missing.push('at least one size');
  if (!Array.isArray(product?.colours) || product.colours.length === 0) missing.push('at least one colour');
  return missing;
}
