import { isDeepStrictEqual } from 'node:util';
import { httpError } from './http.js';
import {
  findProductVariant,
  getVariantAvailability,
  getVariantPrice,
  getVariantStatus
} from './productVariants.js';

const MAX_ORDER_ITEMS = 50;
const MAX_ITEM_QUANTITY = 20;

function isObjectId(value) {
  return /^[a-f\d]{24}$/i.test(String(value || ''));
}

function validatePricing(pricing) {
  const valid = pricing &&
    Number.isFinite(pricing.paisePerCatalogUnit) &&
    pricing.paisePerCatalogUnit > 0 &&
    Number.isFinite(pricing.shippingThreshold) &&
    pricing.shippingThreshold >= 0 &&
    Number.isFinite(pricing.shippingFee) &&
    pricing.shippingFee >= 0 &&
    Number.isFinite(pricing.taxRate) &&
    pricing.taxRate >= 0 &&
    pricing.taxRate <= 1;

  if (!valid) throw httpError(500, 'Checkout pricing is not configured.', 'CHECKOUT_CONFIGURATION_INVALID');
}

export function getCheckoutProductIds(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ORDER_ITEMS) {
    throw httpError(400, 'Your bag is empty or contains too many items.');
  }

  return items.map((item) => {
    const productId = String(item?.product || item?.productId || '');
    const quantity = Number(item?.quantity);
    if (!isObjectId(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
      throw httpError(400, 'One of the selected products or quantities is invalid.');
    }
    return productId;
  });
}

export function assertCheckoutQuoteMatches(signedQuote, currentQuote) {
  if (!isDeepStrictEqual(signedQuote, currentQuote)) {
    throw httpError(409, 'Product prices or availability changed. Review your order before continuing.', 'PRICE_OR_AVAILABILITY_CHANGED');
  }
}

export function buildCheckoutQuote(items, products, pricing) {
  validatePricing(pricing);
  const productIds = getCheckoutProductIds(items);
  if (!Array.isArray(products)) throw new TypeError('Checkout products must be an array.');

  const productById = new Map(products.map((product) => [String(product._id).toLowerCase(), product]));
  const lines = [];
  const requestedByInventory = new Map();
  let originalSubtotalPaise = 0;
  let subtotalPaise = 0;

  for (const [index, item] of items.entries()) {
    const productId = productIds[index];
    const quantity = Number(item?.quantity);
    const product = productById.get(productId.toLowerCase());
    if (!product || product.active === false || !['men', 'unisex'].includes(product.gender)) {
      throw httpError(404, 'One of the selected products is no longer available.');
    }

    const size = String(item.size || 'N/A');
    const colour = String(item.colour || 'Default');
    const sizes = Array.isArray(product.sizes) ? product.sizes : [];
    const colours = Array.isArray(product.colours) ? product.colours : [];
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (sizes.length && !sizes.includes(size)) throw httpError(400, `Please select a valid size for ${product.name}.`);
    if (colours.length && !colours.some((entry) => String(entry.name || '').toLowerCase() === colour.toLowerCase())) {
      throw httpError(400, `Please select a valid colour for ${product.name}.`);
    }

    const variant = findProductVariant(product, size, colour);
    if (variants.length && !variant) throw httpError(409, `The selected size and colour for ${product.name} are unavailable.`);
    if (variant && getVariantStatus(product, size, colour) !== 'active') {
      throw httpError(409, `The selected size and colour for ${product.name} are unavailable.`);
    }
    const availableStock = getVariantAvailability(product, size, colour);
    const inventoryKey = `${productId.toLowerCase()}:${variant?.sku || 'aggregate'}`;
    const requestedQuantity = (requestedByInventory.get(inventoryKey) || 0) + quantity;
    if (!Number.isSafeInteger(availableStock) || requestedQuantity > availableStock) {
      throw httpError(409, `Insufficient stock for ${product.name}.`);
    }
    requestedByInventory.set(inventoryKey, requestedQuantity);

    const { pricePaise, originalPricePaise } = getVariantPrice(product, size, colour);
    const lineTotalPaise = pricePaise * quantity;
    const originalLineTotalPaise = originalPricePaise * quantity;
    if (![pricePaise, originalPricePaise, lineTotalPaise, originalLineTotalPaise].every(Number.isSafeInteger) ||
      pricePaise < 0 || originalPricePaise < 0) {
      throw httpError(409, `Pricing for ${product.name} is unavailable.`);
    }

    const colourGallery = colours.find((entry) => String(entry.name || '').toLowerCase() === colour.toLowerCase())?.images || [];
    lines.push({
      productId: String(product._id),
      sku: variant?.sku || null,
      name: product.name,
      image: variant?.images?.[0] || colourGallery[0] || product.images?.[0] || '',
      category: product.category,
      pricePaise,
      originalPricePaise,
      quantity,
      size: variant?.size || size,
      colour: variant?.colour || colour,
      availableStock
    });
    subtotalPaise += lineTotalPaise;
    originalSubtotalPaise += originalLineTotalPaise;
  }

  if (!Number.isSafeInteger(subtotalPaise) || !Number.isSafeInteger(originalSubtotalPaise)) {
    throw httpError(409, 'Checkout totals are unavailable.');
  }

  const discountPaise = Math.max(0, originalSubtotalPaise - subtotalPaise);
  const thresholdPaise = pricing.shippingThreshold * pricing.paisePerCatalogUnit;
  const shippingFeePaise = subtotalPaise >= thresholdPaise
    ? 0
    : Math.round(pricing.shippingFee * pricing.paisePerCatalogUnit);
  const taxCatalogCents = Math.round((subtotalPaise / pricing.paisePerCatalogUnit) * pricing.taxRate * 100);
  const taxPaise = taxCatalogCents * (pricing.paisePerCatalogUnit / 100);
  const totalPaise = subtotalPaise + shippingFeePaise + taxPaise;

  if (![discountPaise, shippingFeePaise, taxPaise, totalPaise].every(Number.isSafeInteger)) {
    throw httpError(409, 'Checkout totals are unavailable.');
  }

  return {
    lines,
    originalSubtotalPaise,
    discountPaise,
    subtotalPaise,
    shippingFeePaise,
    taxPaise,
    totalPaise
  };
}
