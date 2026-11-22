import { getVariantPrice } from './productVariants.js';

const LEGACY_SKU_KEY = 'legacy';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_POLICY = { lowStockThreshold: 10, criticalStockThreshold: 3 };
const CSV_COLUMNS = [
  ['productName', 'Product'],
  ['category', 'Category'],
  ['demoLabel', 'Catalogue label'],
  ['sku', 'SKU'],
  ['size', 'Size'],
  ['colour', 'Colour'],
  ['variantStatus', 'Variant status'],
  ['onHand', 'On hand'],
  ['reservedQuantity', 'Reserved'],
  ['availableStock', 'Available'],
  ['committedQuantity', 'Committed'],
  ['incomingQuantity', 'Incoming'],
  ['status', 'Stock status'],
  ['pricePaise', 'Retail price (paise)'],
  ['retailValuePaise', 'Retail value (paise)'],
  ['costedQuantity', 'Costed quantity'],
  ['costedValuePaise', 'Known cost value (paise)'],
  ['costCoverage', 'Cost coverage'],
  ['lastActivity', 'Last activity'],
  ['updatedAt', 'Last updated']
];

const asDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

const asQuantity = (value) => {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : 0;
};

const isSafeAmount = (value) => Number.isSafeInteger(value) && value >= 0;
const identity = (value) => String(value?._id ?? value ?? '');
const inventoryKey = (productId, sku) => `${identity(productId)}:${sku || LEGACY_SKU_KEY}`;

function getIncomingQuantity(receipt) {
  if (String(receipt.status || '').toLowerCase() !== 'open') return 0;
  const expected = asQuantity(receipt.expectedQuantity);
  const accounted = asQuantity(receipt.receivedQuantity) +
    asQuantity(receipt.damagedQuantity) +
    asQuantity(receipt.rejectedQuantity) +
    asQuantity(receipt.cancelledQuantity);
  return Math.max(0, expected - accounted);
}

function getStockStatus(available, lowThreshold, criticalThreshold) {
  if (available <= 0) return { status: 'out_of_stock', stockStatus: 'out_of_stock' };
  if (available <= criticalThreshold) return { status: 'low_stock', stockStatus: 'critical_stock' };
  if (available <= lowThreshold) return { status: 'low_stock', stockStatus: 'low_stock' };
  return { status: 'in_stock', stockStatus: 'in_stock' };
}

function addMovementDates(movements) {
  const lastActivityBySku = new Map();
  for (const movement of movements) {
    const date = asDate(movement.lastActivity || movement.createdAt);
    if (!date) continue;

    if (movement._id && !Array.isArray(movement.changes)) {
      const key = inventoryKey(movement._id.product, movement._id.sku);
      const previous = lastActivityBySku.get(key);
      if (!previous || date > previous) lastActivityBySku.set(key, date);
      continue;
    }

    if (String(movement.status || 'applied') !== 'applied') continue;
    for (const change of movement.changes || []) {
      if (Number(change.quantityDelta) <= 0) continue;
      const key = inventoryKey(change.product, change.sku);
      const previous = lastActivityBySku.get(key);
      if (!previous || date > previous) lastActivityBySku.set(key, date);
    }
  }
  return lastActivityBySku;
}

function getDemandBySku(orders, now) {
  const demandBySku = new Map();
  const from30 = now.getTime() - (30 * DAY_MS);
  const from90 = now.getTime() - (90 * DAY_MS);

  for (const order of orders) {
    if (String(order.orderStatus || '').toLowerCase() === 'cancelled') continue;
    const createdAt = asDate(order.createdAt);
    if (!createdAt || createdAt.getTime() < from90 || createdAt > now) continue;
    for (const item of order.items || []) {
      const key = inventoryKey(item.product, item.sku);
      const current = demandBySku.get(key) || { demand30Days: 0, demand90Days: 0 };
      const quantity = asQuantity(item.quantity);
      current.demand90Days += quantity;
      if (createdAt.getTime() >= from30) current.demand30Days += quantity;
      demandBySku.set(key, current);
    }
  }
  return demandBySku;
}

function assignVelocity(rows, historyComplete) {
  if (!historyComplete) {
    for (const row of rows) row.velocity = 'insufficient_history';
    return;
  }

  const demandRows = rows.filter((row) => row.demand90Days > 0)
    .sort((left, right) => left.demand90Days - right.demand90Days || String(left.sku).localeCompare(String(right.sku)));
  if (demandRows.length < 4) {
    for (const row of rows) {
      row.velocity = row.demand90Days === 0
        ? (row.availableStock > 0 ? 'dead' : 'no_demand')
        : 'insufficient_cohort';
    }
    return;
  }

  const quartileSize = Math.max(1, Math.ceil(demandRows.length / 4));
  const fastSkus = new Set(demandRows.slice(-quartileSize).map((row) => inventoryKey(row.productId, row.sku)));
  const slowSkus = new Set(demandRows.slice(0, quartileSize).map((row) => inventoryKey(row.productId, row.sku)));
  for (const row of rows) {
    const key = inventoryKey(row.productId, row.sku);
    row.velocity = row.demand90Days === 0
      ? (row.availableStock > 0 ? 'dead' : 'no_demand')
      : fastSkus.has(key) ? 'fast' : slowSkus.has(key) ? 'slow' : 'steady';
  }
}

export function buildInventoryReadModel({
  products = [],
  movements = [],
  receipts = [],
  orders = [],
  policy = {},
  committedQuantities = new Map(),
  orderHistoryCoveredFrom = null,
  now: inputNow = new Date()
} = {}) {
  const now = asDate(inputNow) || new Date();
  const lowStockThreshold = asQuantity(policy.lowStockThreshold ?? DEFAULT_POLICY.lowStockThreshold);
  const criticalStockThreshold = Math.min(
    lowStockThreshold,
    asQuantity(policy.criticalStockThreshold ?? DEFAULT_POLICY.criticalStockThreshold)
  );
  const incomingBySku = new Map();
  for (const receipt of receipts) {
    const key = inventoryKey(receipt.product, receipt.sku);
    incomingBySku.set(key, (incomingBySku.get(key) || 0) + getIncomingQuantity(receipt));
  }
  const lastActivityBySku = addMovementDates(movements);
  const demandBySku = getDemandBySku(orders, now);
  const historyStart = asDate(orderHistoryCoveredFrom);
  const historyComplete = Boolean(historyStart && historyStart.getTime() <= now.getTime() - (90 * DAY_MS));

  const inventory = products.flatMap((product) => {
    const variants = Array.isArray(product.variants) && product.variants.length ? product.variants : [null];
    return variants.map((variant) => {
      const sku = variant?.sku || null;
      const key = inventoryKey(product._id, sku);
      const onHand = asQuantity(variant?.stock ?? product.stock);
      const reservedQuantity = Math.min(onHand, asQuantity(variant?.reservedQuantity));
      const availableStock = Math.max(0, onHand - reservedQuantity);
      const committedQuantity = Math.min(
        reservedQuantity,
        asQuantity(committedQuantities instanceof Map
          ? committedQuantities.get(key)
          : committedQuantities[key])
      );
      const incomingQuantity = incomingBySku.get(key) || 0;
      const selectedPrice = getVariantPrice(product, variant?.size, variant?.colour);
      const pricePaise = isSafeAmount(selectedPrice.pricePaise) ? selectedPrice.pricePaise : null;
      const retailValuePaise = pricePaise !== null && isSafeAmount(onHand * pricePaise)
        ? onHand * pricePaise
        : null;
      const costedQuantity = Math.min(onHand, asQuantity(variant?.costedQuantity));
      const unitCostPaise = isSafeAmount(variant?.unitCostPaise) ? variant.unitCostPaise : null;
      const costedValuePaise = unitCostPaise !== null && isSafeAmount(unitCostPaise * costedQuantity)
        ? unitCostPaise * costedQuantity
        : null;
      const costCoverage = onHand === 0
        ? 'complete'
        : costedQuantity === 0 || costedValuePaise === null
          ? 'unknown'
          : costedQuantity < onHand ? 'partial' : 'complete';
      const lastActivity = lastActivityBySku.get(key) || null;
      const demand = demandBySku.get(key) || { demand30Days: 0, demand90Days: 0 };
      const { status, stockStatus } = getStockStatus(availableStock, lowStockThreshold, criticalStockThreshold);
      const reorderTarget = Number.isSafeInteger(variant?.reorderTarget) && variant.reorderTarget >= 0
        ? variant.reorderTarget
        : null;

      return {
        productId: product._id,
        productName: product.name,
        category: product.category,
        isDemoData: product.isDemoData === true,
        demoKey: product.demoKey || '',
        demoLabel: product.isDemoData === true ? (product.demoLabel || 'DEMO CATALOGUE') : '',
        active: product.active !== false,
        variantStatus: variant?.status || 'active',
        sku,
        size: variant?.size || '',
        colour: variant?.colour || '',
        image: variant?.images?.[0] || product.colours?.find((entry) =>
          String(entry.name || '').toLowerCase() === String(variant?.colour || '').toLowerCase()
        )?.images?.[0] || product.images?.[0] || '',
        onHand,
        stock: onHand,
        reservedQuantity,
        availableStock,
        committedQuantity,
        incomingQuantity,
        pricePaise,
        retailValuePaise,
        unitCostPaise,
        costedQuantity,
        costedValuePaise,
        uncostedQuantity: onHand - costedQuantity,
        costCoverage,
        acquisitionValuePaise: costCoverage === 'complete' ? costedValuePaise ?? 0 : null,
        lastActivity,
        updatedAt: asDate(product.updatedAt),
        stockAgeDays: lastActivity ? Math.max(0, Math.floor((now.getTime() - lastActivity.getTime()) / DAY_MS)) : null,
        demand30Days: demand.demand30Days,
        demand90Days: demand.demand90Days,
        demandCoverage: historyComplete ? 'complete' : 'insufficient_history',
        velocity: 'insufficient_history',
        reorderTarget,
        restockSuggestion: reorderTarget === null
          ? null
          : Math.max(0, reorderTarget - availableStock - incomingQuantity),
        status,
        stockStatus
      };
    });
  });

  assignVelocity(inventory, historyComplete);
  const productIds = new Set(inventory.map((item) => identity(item.productId)));
  const unknownRetail = inventory.some((item) => item.onHand > 0 && item.retailValuePaise === null);
  const uncostedQuantity = inventory.reduce((total, item) => total + item.uncostedQuantity, 0);
  const costedValuePaise = inventory.reduce((total, item) => total + (item.costedValuePaise || 0), 0);
  const summary = {
    totalProducts: productIds.size,
    totalSkus: inventory.filter((item) => item.sku !== null).length,
    stockRecords: inventory.length,
    unitsOnHand: inventory.reduce((total, item) => total + item.onHand, 0),
    unallocatedLegacyUnits: inventory.reduce(
      (total, item) => total + (item.sku === null ? item.onHand : 0),
      0
    ),
    availableUnits: inventory.reduce((total, item) => total + item.availableStock, 0),
    reservedUnits: inventory.reduce((total, item) => total + item.reservedQuantity, 0),
    committedUnits: inventory.reduce((total, item) => total + item.committedQuantity, 0),
    incomingUnits: inventory.reduce((total, item) => total + item.incomingQuantity, 0),
    lowStockRecords: inventory.filter((item) => item.status === 'low_stock').length,
    criticalStockRecords: inventory.filter((item) => item.stockStatus === 'critical_stock').length,
    outOfStockRecords: inventory.filter((item) => item.status === 'out_of_stock').length,
    retailValuePaise: unknownRetail ? null : inventory.reduce((total, item) => total + (item.retailValuePaise || 0), 0),
    costedQuantity: inventory.reduce((total, item) => total + item.costedQuantity, 0),
    costedValuePaise,
    uncostedQuantity,
    acquisitionValuePaise: uncostedQuantity === 0 ? costedValuePaise : null,
    pendingReceiptCount: receipts.filter((receipt) => String(receipt.status || '').toLowerCase() === 'open').length
  };

  return { inventory, summary, lowStockThreshold, criticalStockThreshold };
}

export function buildDashboardLowStockSummary(products = [], policy = undefined) {
  const { inventory } = buildInventoryReadModel({ products, policy });
  const byProduct = new Map();
  for (const row of inventory) {
    if (!row.active || row.variantStatus !== 'active' || row.status !== 'low_stock') continue;
    const productId = identity(row.productId);
    if (!productId) continue;
    if (!byProduct.has(productId)) {
      byProduct.set(productId, { productId, name: row.productName, updatedAt: row.updatedAt, variants: [] });
    }
    byProduct.get(productId).variants.push({ sku: row.sku, availableStock: row.availableStock });
  }
  const lowStockProducts = [...byProduct.values()];
  return { count: lowStockProducts.length, products: lowStockProducts };
}

export function filterInventoryRows(rows, {
  search = '',
  status = 'all',
  active = 'all',
  category = 'all',
  variantStatus = 'all',
  incomingOnly = false,
  sort = 'name-asc'
} = {}) {
  const term = String(search).trim().toLowerCase();
  const selectedStatus = String(status || 'all').toLowerCase();
  const selectedCategory = String(category || 'all').toLowerCase();
  const selectedActive = String(active || 'all').toLowerCase();
  const selectedVariantStatus = String(variantStatus || 'all').toLowerCase();
  const filtered = rows.filter((row) => {
    if (incomingOnly && !(Number(row.incomingQuantity) > 0)) return false;
    if (selectedStatus !== 'all' && row.status !== selectedStatus && row.stockStatus !== selectedStatus) return false;
    if (selectedCategory !== 'all' && String(row.category || '').toLowerCase() !== selectedCategory) return false;
    if (selectedActive !== 'all' && String(row.active) !== selectedActive) return false;
    if (selectedVariantStatus !== 'all' && String(row.variantStatus || 'active').toLowerCase() !== selectedVariantStatus) return false;
    if (!term) return true;
    return [row.productName, row.sku, row.size, row.colour, row.category]
      .some((value) => String(value || '').toLowerCase().includes(term));
  });

  const sorters = {
    'name-asc': (a, b) => String(a.productName).localeCompare(String(b.productName)),
    'name-desc': (a, b) => String(b.productName).localeCompare(String(a.productName)),
    'sku-asc': (a, b) => String(a.sku || '').localeCompare(String(b.sku || '')),
    'sku-desc': (a, b) => String(b.sku || '').localeCompare(String(a.sku || '')),
    'available-asc': (a, b) => a.availableStock - b.availableStock,
    'available-desc': (a, b) => b.availableStock - a.availableStock,
    'on-hand-asc': (a, b) => a.onHand - b.onHand,
    'on-hand-desc': (a, b) => b.onHand - a.onHand,
    'incoming-desc': (a, b) => b.incomingQuantity - a.incomingQuantity,
    'updated-desc': (a, b) => (asDate(b.lastActivity)?.getTime() || 0) - (asDate(a.lastActivity)?.getTime() || 0)
  };
  const compare = sorters[sort] || sorters['name-asc'];
  return filtered.sort((a, b) => compare(a, b) || String(a.sku || a.productId).localeCompare(String(b.sku || b.productId)));
}

export function paginateInventoryRows(rows, page = 1, limit = 50) {
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50));
  const totalCount = rows.length;
  const totalPages = Math.ceil(totalCount / pageSize);
  const requestedPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const currentPage = totalPages ? Math.min(requestedPage, totalPages) : 1;
  const start = (currentPage - 1) * pageSize;
  return {
    inventory: rows.slice(start, start + pageSize),
    totalCount,
    currentPage,
    totalPages,
    pageSize
  };
}

const escapeCsvValue = (value) => {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
};

export function inventoryRowsToCsv(rows) {
  return [
    CSV_COLUMNS.map(([, label]) => escapeCsvValue(label)).join(','),
    ...rows.map((row) => CSV_COLUMNS.map(([key]) => escapeCsvValue(row[key])).join(','))
  ].join('\r\n');
}
