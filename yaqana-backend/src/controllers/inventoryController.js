import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import InventoryInbound from '../models/InventoryInbound.js';
import InventoryApproval from '../models/InventoryApproval.js';
import InventoryPolicy from '../models/InventoryPolicy.js';
import AdminAudit from '../models/AdminAudit.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import { asyncHandler, httpError } from '../utils/http.js';
import {
  buildInventoryReadModel,
  filterInventoryRows,
  inventoryRowsToCsv,
  paginateInventoryRows
} from '../utils/inventoryReadModel.js';
import { normalizeInventoryAdjustments } from '../utils/inventoryAdjustments.js';
import { buildVariantStockAdjustment, calculateStockAfterAdjustment } from '../utils/variantInventory.js';
import {
  canReviewInventoryApproval,
  getInventoryAdjustmentOutcome
} from '../utils/inventoryApprovalPolicy.js';
import { supportsMongoTransactions } from '../utils/mongoTransactions.js';
import { applySingleInventoryAdjustment } from '../services/inventoryAdjustmentService.js';
import { restoreInventorySku as restoreInventorySkuLifecycle } from '../services/inventorySkuLifecycleService.js';
import { receiveInventoryInbound, inventoryReceiptRequestHash } from '../services/inventoryReceivingService.js';
import { normalizeInboundDraft } from '../utils/inventoryReceiving.js';
import {
  buildLegacyAllocationPreview,
  normalizeVerifiedUnitCost,
  previewStocktake,
  previewInventoryCsv
} from '../utils/inventoryOperations.js';

const LOW_STOCK_THRESHOLD = 10;
export const inventoryAdjustmentRequestHash = (adjustments, reason, metadata = {}) => createHash('sha256')
  .update(JSON.stringify(
    (metadata.type === undefined || metadata.type === 'manual') &&
    (metadata.reference === undefined || metadata.reference === '') &&
    (metadata.notes === undefined || metadata.notes === '') &&
    (metadata.enhancedConfirmed === undefined || metadata.enhancedConfirmed === false) &&
    (metadata.approvalLevel === undefined || metadata.approvalLevel === null)
      ? { adjustments, reason }
      : { adjustments, reason, metadata }
  ))
  .digest('hex');
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MOVEMENT_TYPES = new Set([
  'manual',
  'order',
  'order_cancel',
  'purchase_receipt',
  'return',
  'opening_stock',
  'correction',
  'damaged',
  'lost',
  'restock'
]);
const INVENTORY_STATUSES = new Set(['all', 'in_stock', 'low_stock', 'critical_stock', 'out_of_stock']);
const INVENTORY_VARIANT_STATUSES = new Set(['all', 'active', 'inactive', 'discontinued']);
const INVENTORY_SORTS = new Set([
  'name-asc',
  'name-desc',
  'sku-asc',
  'sku-desc',
  'available-asc',
  'available-desc',
  'on-hand-asc',
  'on-hand-desc',
  'incoming-desc',
  'updated-desc'
]);
const APPROVAL_STATUSES = new Set(['all', 'pending', 'approved', 'applied', 'rejected']);
const APPROVAL_LEVELS = new Set(['all', 'admin', 'owner']);
const INBOUND_STATUSES = new Set(['all', 'open', 'closed', 'cancelled']);
const DEFAULT_INVENTORY_POLICY = Object.freeze({
  lowStockThreshold: 10,
  criticalStockThreshold: 3,
  normalAdjustmentLimit: 10,
  enhancedConfirmationLimit: 25,
  adminApprovalLimit: 50,
  prepaidReservationTtlMinutes: 15
});

const parseQueryInteger = (value, label, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw httpError(400, `${label} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return parsed;
};

async function loadInventorySnapshot() {
  const now = new Date();
  const orderStart = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
  const [products, policy, receipts, orders, oldestOrder, movements] = await Promise.all([
    Product.find({})
      .select('name category active stock pricePaise discountPricePaise images colours variants updatedAt isDemoData demoKey demoLabel')
      .sort({ name: 1 })
      .lean(),
    InventoryPolicy.findOne({ scope: 'global' }).lean(),
    InventoryInbound.find({ status: 'open' })
      .select('product sku expectedQuantity receivedQuantity damagedQuantity rejectedQuantity cancelledQuantity status')
      .lean(),
    Order.find({ createdAt: { $gte: orderStart }, orderStatus: { $ne: 'Cancelled' } })
      .select('createdAt orderStatus items.product items.sku items.quantity')
      .lean(),
    Order.findOne({}).sort({ createdAt: 1 }).select('createdAt').lean(),
    StockMovement.aggregate([
      { $match: { status: 'applied', 'changes.quantityDelta': { $gt: 0 } } },
      { $unwind: '$changes' },
      { $match: { 'changes.quantityDelta': { $gt: 0 } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { product: '$changes.product', sku: '$changes.sku' },
          lastActivity: { $first: '$createdAt' }
        }
      }
    ])
  ]);
  return buildInventoryReadModel({
    products,
    policy: policy || { lowStockThreshold: LOW_STOCK_THRESHOLD, criticalStockThreshold: 3 },
    receipts,
    orders,
    movements,
    orderHistoryCoveredFrom: oldestOrder?.createdAt,
    now
  });
}

export const getInventory = asyncHandler(async (req, res) => {
  const query = req.query || {};
  const page = parseQueryInteger(query.page, 'Page');
  const limit = parseQueryInteger(query.limit, 'Page size', { maximum: 100 });
  const search = query.search === undefined ? '' : String(query.search).trim();
  const category = query.category === undefined ? 'all' : String(query.category).trim();
  const status = query.status === undefined ? 'all' : String(query.status).trim().toLowerCase();
  const active = query.active === undefined ? 'all' : String(query.active).trim().toLowerCase();
  const variantStatus = query.variantStatus === undefined ? 'all' : String(query.variantStatus).trim().toLowerCase();
  const incomingOnly = query.incomingOnly === 'true';
  const sort = query.sort === undefined ? 'name-asc' : String(query.sort).trim();
  if (search.length > 100 || category.length > 100) throw httpError(400, 'Inventory search and category filters are limited to 100 characters.');
  if (!INVENTORY_STATUSES.has(status)) throw httpError(400, 'Inventory status filter is invalid.');
  if (!['all', 'true', 'false'].includes(active)) throw httpError(400, 'Inventory active filter is invalid.');
  if (!INVENTORY_VARIANT_STATUSES.has(variantStatus)) throw httpError(400, 'Variant lifecycle filter is invalid.');
  if (!INVENTORY_SORTS.has(sort)) throw httpError(400, 'Inventory sort option is invalid.');

  const snapshot = await loadInventorySnapshot();
  const filtered = filterInventoryRows(snapshot.inventory, { search, category, status, active, variantStatus, incomingOnly, sort });
  const hasQuery = Object.keys(query).length > 0;
  const pageResult = hasQuery
    ? paginateInventoryRows(filtered, page || 1, limit || 50)
    : null;
  const body = {
    success: true,
    inventory: pageResult?.inventory || snapshot.inventory,
    lowStockThreshold: snapshot.lowStockThreshold,
    criticalStockThreshold: snapshot.criticalStockThreshold,
    transactionSupportAvailable: supportsMongoTransactions(),
    summary: snapshot.summary
  };
  if (pageResult) {
    body.totalCount = pageResult.totalCount;
    body.totalPages = pageResult.totalPages;
    body.currentPage = pageResult.currentPage;
    body.pageSize = pageResult.pageSize;
  }
  res.json(body);
});

export const restoreInventorySku = asyncHandler(async (req, res) => {
  const productId = String(req.params.productId || '');
  const sku = String(req.params.sku || '').trim().toUpperCase();
  const reason = String(req.body?.reason || '').trim();
  if (!mongoose.isValidObjectId(productId)) throw httpError(400, 'Product ID is invalid.');
  if (!/^[A-Z0-9][A-Z0-9._-]{1,47}$/.test(sku)) throw httpError(400, 'SKU is invalid.');
  if (reason.length < 5 || reason.length > 500) {
    throw httpError(400, 'Provide an audit reason between 5 and 500 characters.');
  }

  const restored = await restoreInventorySkuLifecycle({
    productId,
    sku,
    actorId: req.user._id,
    reason,
    connection: mongoose.connection,
    startSession: () => mongoose.startSession(),
    ProductModel: Product,
    AdminAuditModel: AdminAudit
  });
  res.json({
    success: true,
    message: `SKU ${restored.sku} restored; product publication status was not changed.`,
    sku: restored
  });
});

export const getInventoryMovements = asyncHandler(async (req, res) => {
  const page = parseQueryInteger(req.query.page, 'Page') || 1;
  const limit = parseQueryInteger(req.query.limit, 'Page size', { maximum: 100 }) || 50;
  const query = {};
  if (req.query.productId) {
    if (!mongoose.isValidObjectId(req.query.productId)) throw httpError(400, 'Product ID is invalid.');
    query['changes.product'] = req.query.productId;
  }
  if (req.query.sku) query['changes.sku'] = String(req.query.sku).trim().toUpperCase();
  if (req.query.type) {
    const type = String(req.query.type).trim();
    if (!MOVEMENT_TYPES.has(type)) throw httpError(400, 'Inventory movement type is invalid.');
    query.type = type;
  }
  if (req.query.search) {
    const search = String(req.query.search).trim();
    if (!search || search.length > 100) throw httpError(400, 'Movement search must be between 1 and 100 characters.');
    const pattern = new RegExp(escapeRegex(search), 'i');
    query.$or = [
      { reason: pattern },
      { reference: pattern },
      { notes: pattern },
      { 'changes.productName': pattern },
      { 'changes.sku': pattern }
    ];
  }
  const from = req.query.from === undefined ? undefined : new Date(String(req.query.from));
  const to = req.query.to === undefined ? undefined : new Date(String(req.query.to));
  if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) {
    throw httpError(400, 'Movement date filters must be valid dates.');
  }
  if (from && to && from > to) throw httpError(400, 'Movement start date must not be after the end date.');
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to) query.createdAt.$lte = to;
  }
  query.status = { $nin: ['pending', 'applying', 'rejected'] };
  const [movements, totalCount] = await Promise.all([
    StockMovement.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('performedBy', 'name email'),
    StockMovement.countDocuments(query)
  ]);
  res.json({ success: true, movements, totalCount, currentPage: page, totalPages: Math.ceil(totalCount / limit) });
});

export const exportInventoryCsv = asyncHandler(async (req, res) => {
  const snapshot = await loadInventorySnapshot();
  const filters = {
    search: String(req.query?.search || '').slice(0, 100),
    category: String(req.query?.category || 'all').slice(0, 100),
    status: String(req.query?.status || 'all').toLowerCase(),
    active: String(req.query?.active || 'all').toLowerCase(),
    variantStatus: String(req.query?.variantStatus || 'all').toLowerCase(),
    sort: String(req.query?.sort || 'name-asc')
  };
  if (!INVENTORY_STATUSES.has(filters.status) ||
    !['all', 'true', 'false'].includes(filters.active) ||
    !INVENTORY_VARIANT_STATUSES.has(filters.variantStatus) ||
    !INVENTORY_SORTS.has(filters.sort)) {
    throw httpError(400, 'Inventory export filters are invalid.');
  }
  const csv = inventoryRowsToCsv(filterInventoryRows(snapshot.inventory, filters));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="yaqana-inventory-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

export const setInventoryReorderTarget = asyncHandler(async (req, res) => {
  const sku = String(req.params.sku || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,47}$/.test(sku)) throw httpError(400, 'SKU is invalid.');
  const rawTarget = req.body?.reorderTarget;
  const reorderTarget = rawTarget === null || rawTarget === '' ? null : Number(rawTarget);
  if (reorderTarget !== null && (!Number.isSafeInteger(reorderTarget) || reorderTarget < 0)) {
    throw httpError(400, 'Restock target must be a non-negative whole number.');
  }
  const current = await Product.findOne({ 'variants.sku': sku })
    .select('variants.sku variants.reorderTarget').lean();
  if (!current) throw httpError(404, 'Inventory SKU was not found.');
  const currentVariant = current.variants.find((entry) => entry.sku === sku);
  const previousTarget = currentVariant?.reorderTarget ?? null;
  const targetRef = { targetType: 'inventory_sku', targetId: sku };
  await AdminAudit.create({
    actor: req.user._id,
    action: 'inventory.reorder_target.update.started',
    reason: 'Administrator started an SKU reorder target update.',
    before: { reorderTarget: previousTarget },
    after: { reorderTarget },
    metadata: { ...targetRef, phase: 'intent' }
  });
  const updated = await Product.findOneAndUpdate(
    { variants: { $elemMatch: { sku, reorderTarget: previousTarget } } },
    { $set: { 'variants.$.reorderTarget': reorderTarget } },
    { new: false, runValidators: true }
  ).select('variants.sku variants.reorderTarget').lean();
  if (!updated) throw httpError(404, 'Inventory SKU was not found.');
  await AdminAudit.create({
    actor: req.user._id,
    action: 'inventory.reorder_target.update',
    targetType: 'inventory_sku',
    targetId: sku,
    before: { reorderTarget: previousTarget },
    after: { reorderTarget },
    reason: 'Administrator updated an SKU reorder target.',
    metadata: { ...targetRef, phase: 'completed' }
  });
  res.json({ success: true, sku, reorderTarget });
});

export const getInventoryPolicy = asyncHandler(async (_req, res) => {
  const policy = await InventoryPolicy.findOne({ scope: 'global' }).lean();
  res.json({ success: true, policy: policy || DEFAULT_INVENTORY_POLICY });
});

export const getLegacyAllocationPreview = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) throw httpError(400, 'Product ID is invalid.');
  const product = await Product.findById(req.params.productId)
    .select('name stock variants.sku variants.size variants.colour variants.stock variants.status')
    .lean();
  if (!product) throw httpError(404, 'Product was not found.');
  const rawAllocations = req.query?.allocation;
  const allocations = rawAllocations === undefined
    ? []
    : Array.isArray(rawAllocations) ? rawAllocations : [rawAllocations];
  const parsedAllocations = [];
  for (const allocation of allocations) {
    const [skuValue, quantityValue, extra] = String(allocation).split(':');
    const sku = skuValue?.trim() || '';
    const quantity = Number(quantityValue);
    if (extra !== undefined || !sku || !Number.isSafeInteger(quantity) || quantity < 0) {
      throw httpError(400, 'Each allocation must contain a valid SKU and non-negative whole quantity.');
    }
    parsedAllocations.push({ sku: sku.toUpperCase(), quantity });
  }
  let preview;
  try {
    preview = buildLegacyAllocationPreview({
      productName: product.name,
      originalStock: product.stock,
      availableSkus: (product.variants || []).map((variant) => variant.sku),
      allocations: parsedAllocations
    });
  } catch (error) {
    throw httpError(400, error.message);
  }
  res.json({
    success: true,
    preview,
    variants: (product.variants || []).map((variant) => ({
      sku: variant.sku,
      size: variant.size,
      colour: variant.colour,
      status: variant.status || 'active',
      stock: variant.stock
    })),
    migrationStatus: parsedAllocations.length ? 'review' : 'not_allocated'
  });
});

export const previewInventoryAllocation = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) throw httpError(400, 'Product ID is invalid.');
  const product = await Product.findById(req.params.productId).select('name stock variants.sku variants.size variants.colour').lean();
  if (!product) throw httpError(404, 'Product was not found.');
  const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
  let preview;
  try {
    preview = buildLegacyAllocationPreview({
      productName: product.name,
      originalStock: product.stock,
      availableSkus: (product.variants || []).map((variant) => variant.sku),
      allocations
    });
  } catch (error) {
    throw httpError(400, error.message);
  }
  res.json({ success: true, preview, variants: product.variants || [] });
});

export const updateVerifiedUnitCost = asyncHandler(async (req, res) => {
  if (!supportsMongoTransactions()) {
    throw httpError(503, 'Verified unit-cost changes require MongoDB transaction support.', 'TRANSACTIONS_REQUIRED');
  }
  const sku = String(req.params.sku || '').trim().toUpperCase();
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5 || reason.length > 300) throw httpError(400, 'Provide a unit-cost reason between 5 and 300 characters.');
  let unitCostPaise;
  try {
    unitCostPaise = normalizeVerifiedUnitCost(req.body?.unitCost);
  } catch (error) {
    throw httpError(400, error.message);
  }
  const costedQuantity = Number(req.body?.costedQuantity);
  if (!Number.isSafeInteger(costedQuantity) || costedQuantity < 0) {
    throw httpError(400, 'Costed quantity must be a non-negative whole number.');
  }
  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      const product = await Product.findOne({ 'variants.sku': sku }).session(session);
      if (!product) throw httpError(404, 'Inventory SKU was not found.');
      const variant = product.variants.find((entry) => entry.sku === sku);
      if (!variant) throw httpError(404, 'Inventory SKU was not found.');
      if (costedQuantity > variant.stock) throw httpError(400, 'Costed quantity cannot exceed on-hand stock.');
      const before = {
        unitCostPaise: variant.unitCostPaise ?? null,
        costedQuantity: variant.costedQuantity ?? 0
      };
      variant.unitCostPaise = unitCostPaise;
      variant.costedQuantity = costedQuantity;
      await product.save({ session });
      await AdminAudit.create([{
        actor: req.user._id,
        action: 'inventory.unit_cost.update',
        reason: 'Administrator updated verified unit cost.',
        before,
        after: { unitCostPaise, costedQuantity },
        metadata: { targetType: 'inventory_sku', targetId: sku }
      }], { session });
      updated = variant;
    });
  } finally {
    await session.endSession();
  }
  res.json({ success: true, message: 'Verified unit cost saved.', sku, unitCostPaise, costedQuantity });
});

export const previewInventoryStocktake = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) throw httpError(400, 'Product ID is invalid.');
  const product = await Product.findById(req.params.productId).select('name stock variants.sku variants.stock').lean();
  if (!product) throw httpError(404, 'Product was not found.');
  const sku = req.body?.sku ? String(req.body.sku).trim().toUpperCase() : '';
  const countedQuantity = Number(req.body?.countedQuantity);
  const variant = sku ? product.variants.find((entry) => entry.sku === sku) : null;
  const recordedQuantity = variant ? variant.stock : product.stock;
  let preview;
  try {
    preview = previewStocktake({ recordedQuantity, countedQuantity });
  } catch (error) {
    throw httpError(400, error.message);
  }
  res.json({ success: true, preview, productName: product.name, sku: sku || null });
});

export const previewInventoryCsvImport = asyncHandler(async (req, res) => {
  const csvText = typeof req.body?.csvText === 'string' ? req.body.csvText : '';
  const products = await Product.find({}).select('variants.sku').lean();
  const availableSkus = products.flatMap((product) => (product.variants || []).map((variant) => variant.sku)).filter(Boolean);
  const preview = previewInventoryCsv({ csvText, availableSkus });
  res.json({ success: true, preview, applyAllowed: false, message: 'Preview only. CSV stock application remains blocked until transaction support is verified.' });
});

export const getInventoryInbound = asyncHandler(async (req, res) => {
  const page = parseQueryInteger(req.query?.page, 'Page') || 1;
  const limit = parseQueryInteger(req.query?.limit, 'Page size', { maximum: 100 }) || 25;
  const status = req.query?.status === undefined ? 'open' : String(req.query.status).trim().toLowerCase();
  if (!INBOUND_STATUSES.has(status)) throw httpError(400, 'Inbound receipt status filter is invalid.');
  const filter = {};
  if (status !== 'all') filter.status = status;
  if (req.query?.sku) {
    const sku = String(req.query.sku).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{1,47}$/.test(sku)) throw httpError(400, 'Inbound SKU filter is invalid.');
    filter.sku = sku;
  }
  if (req.query?.search) {
    const search = String(req.query.search).trim();
    if (!search || search.length > 100) throw httpError(400, 'Receipt search must be between 1 and 100 characters.');
    filter.reference = new RegExp(escapeRegex(search), 'i');
  }
  const [receipts, totalCount] = await Promise.all([
    InventoryInbound.find(filter)
      .sort({ expectedDate: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('product', 'name category images variants.sku variants.size variants.colour')
      .populate('createdBy', 'name role')
      .populate('updatedBy', 'name role'),
    InventoryInbound.countDocuments(filter)
  ]);
  res.json({
    success: true,
    receipts,
    totalCount,
    currentPage: page,
    totalPages: Math.ceil(totalCount / limit)
  });
});

export const createInventoryInbound = asyncHandler(async (req, res) => {
  const draft = normalizeInboundDraft(req.body);
  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
    throw httpError(400, 'A valid inbound receipt request key is required.');
  }
  const requestHash = inventoryReceiptRequestHash({
    ...draft,
    expectedDate: draft.expectedDate?.toISOString() || null
  });
  const existing = await InventoryInbound.findOne({ idempotencyKey }).select('+requestHash');
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw httpError(409, 'This inbound receipt request key was already used for different receipt details.', 'IDEMPOTENCY_KEY_REUSED');
    }
    return res.json({ success: true, message: 'This inbound receipt was already created.', receipt: existing });
  }

  const product = await Product.findById(draft.productId).select('name variants.sku').lean();
  if (!product) throw httpError(404, 'The product linked to this receipt was not found.');
  const variants = product.variants || [];
  if (!draft.sku && variants.length) {
    throw httpError(400, 'Select a SKU for products that have variants.');
  }
  if (draft.sku && !variants.some((variant) => variant.sku === draft.sku)) {
    throw httpError(404, 'Inbound SKU was not found for this product.');
  }

  let receipt;
  try {
    [receipt] = await InventoryInbound.create([{
      product: draft.productId,
      sku: draft.sku,
      expectedDate: draft.expectedDate,
      expectedQuantity: draft.expectedQuantity,
      reference: draft.reference,
      unitCostPaise: draft.unitCostPaise,
      status: 'open',
      idempotencyKey,
      requestHash,
      createdBy: req.user._id
    }]);
  } catch (error) {
    if (error.code !== 11000) throw error;
    receipt = await InventoryInbound.findOne({ idempotencyKey }).select('+requestHash');
    if (!receipt) throw error;
    if (receipt.requestHash !== requestHash) {
      throw httpError(409, 'This inbound receipt request key was already used for different receipt details.', 'IDEMPOTENCY_KEY_REUSED');
    }
    return res.json({ success: true, message: 'This inbound receipt was already created.', receipt });
  }
  res.status(201).json({ success: true, message: 'Inbound receipt created.', receipt });
});

export const receiveInventoryInboundController = asyncHandler(async (req, res) => {
  const result = await receiveInventoryInbound({
    receiptId: req.params?.id,
    idempotencyKey: req.get('Idempotency-Key'),
    input: req.body || {},
    performedBy: req.user._id
  });
  res.status(result.replayed ? 200 : 201).json({
    success: true,
    message: result.replayed ? 'This inbound receipt event was already recorded.' : 'Inbound receipt quantities recorded.',
    ...result
  });
});

export const getInventoryApprovals = asyncHandler(async (req, res) => {
  const page = parseQueryInteger(req.query?.page, 'Page') || 1;
  const limit = parseQueryInteger(req.query?.limit, 'Page size', { maximum: 100 }) || 25;
  const status = req.query?.status === undefined ? 'pending' : String(req.query.status).trim().toLowerCase();
  const approvalLevel = req.query?.approvalLevel === undefined
    ? 'all'
    : String(req.query.approvalLevel).trim().toLowerCase();
  if (!APPROVAL_STATUSES.has(status) || !APPROVAL_LEVELS.has(approvalLevel)) {
    throw httpError(400, 'Inventory approval filters are invalid.');
  }
  const filter = {};
  if (status !== 'all') filter.status = status;
  if (approvalLevel !== 'all') filter.approvalLevel = approvalLevel;
  const [approvals, totalCount] = await Promise.all([
    InventoryApproval.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('requestedBy', 'name role')
      .populate('reviewedBy', 'name role')
      .populate('movementId'),
    InventoryApproval.countDocuments(filter)
  ]);
  res.json({
    success: true,
    approvals,
    totalCount,
    currentPage: page,
    totalPages: Math.ceil(totalCount / limit)
  });
});

export const approveInventoryAdjustment = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params?.id)) throw httpError(400, 'Inventory approval ID is invalid.');
  let approval = await InventoryApproval.findById(req.params.id);
  if (!approval) throw httpError(404, 'Inventory approval was not found.');
  if (approval.status === 'applied') {
    return res.json({ success: true, message: 'This approved adjustment was already applied.', approval });
  }
  if (approval.approvalLevel !== 'admin') {
    throw httpError(403, 'This adjustment requires the approved Owner authorization workflow.', 'OWNER_APPROVAL_REQUIRED');
  }
  if (approval.status === 'rejected') throw httpError(409, 'This inventory adjustment was rejected.', 'INVENTORY_ADJUSTMENT_REJECTED');
  if (approval.status === 'approved' && String(approval.approvedBy) !== String(req.user._id)) {
    throw httpError(409, 'Only the approving Admin may safely resume this inventory adjustment.', 'APPROVAL_REVIEWER_MISMATCH');
  }
  let approvalAuditIntentWritten = false;
  if (approval.status === 'pending') {
    if (!canReviewInventoryApproval(approval, req.user)) {
      if (String(approval.requestedBy) === String(req.user._id)) {
        throw httpError(403, 'An Admin cannot approve their own inventory adjustment.', 'SELF_APPROVAL_FORBIDDEN');
      }
      throw httpError(403, 'This account cannot approve the inventory adjustment.');
    }
    await AdminAudit.create({
      actor: req.user._id,
      action: 'inventory.approval.apply.started',
      reason: 'Administrator started an inventory adjustment approval.',
      before: { status: 'pending' },
      after: { status: 'applied' },
      metadata: { targetType: 'inventory_approval', targetId: String(approval._id), phase: 'intent' }
    });
    approvalAuditIntentWritten = true;
    approval = await InventoryApproval.findOneAndUpdate(
      {
        _id: approval._id,
        status: 'pending',
        approvalLevel: 'admin',
        requestedBy: { $ne: req.user._id }
      },
      {
        $set: {
          status: 'approved',
          approvedBy: req.user._id,
          reviewedBy: req.user._id,
          reviewedAt: new Date(),
          approvedAt: new Date()
        }
      },
      { new: true, runValidators: true }
    );
    if (!approval) throw httpError(409, 'This inventory approval was already reviewed.', 'APPROVAL_ALREADY_REVIEWED');
  }
  if (approval.status !== 'approved') throw httpError(409, 'This inventory approval cannot be applied in its current state.');
  if (!approvalAuditIntentWritten) {
    await AdminAudit.create({
      actor: req.user._id,
      action: 'inventory.approval.apply.started',
      reason: 'Administrator started an inventory adjustment approval.',
      before: { status: 'approved' },
      after: { status: 'applied' },
      metadata: { targetType: 'inventory_approval', targetId: String(approval._id), phase: 'intent' }
    });
  }

  const adjustment = {
    sku: approval.sku,
    productId: approval.sku ? undefined : String(approval.product),
    delta: approval.quantityDelta
  };
  const hash = inventoryAdjustmentRequestHash(
    [adjustment],
    approval.reason,
    {
      type: approval.type,
      reference: approval.reference,
      notes: approval.notes,
      approvalLevel: approval.approvalLevel
    }
  );
  const result = await applySingleInventoryAdjustment({
    adjustment,
    reason: approval.reason,
    idempotencyKey: `inventory-approval-${String(approval._id)}`,
    requestHash: hash,
    performedBy: approval.approvedBy,
    type: approval.type,
    reference: approval.reference,
    notes: approval.notes,
    approvalId: approval._id
  });
  approval.status = 'applied';
  approval.appliedAt = new Date();
  approval.movementId = result.movement._id;
  await approval.save();
  await AdminAudit.create({
    actor: req.user._id,
    action: 'inventory.approval.apply',
    reason: 'Administrator approved and applied an inventory adjustment.',
    before: { status: 'pending' },
    after: { status: 'applied' },
    metadata: { targetType: 'inventory_approval', targetId: String(approval._id), movementId: String(result.movement._id), phase: 'completed' }
  });
  res.json({ success: true, message: 'Inventory adjustment approved and applied.', approval, movement: result.movement });
});

export const rejectInventoryAdjustment = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params?.id)) throw httpError(400, 'Inventory approval ID is invalid.');
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 300) {
    throw httpError(400, 'Provide a rejection reason between 5 and 300 characters.');
  }
  const approval = await InventoryApproval.findById(req.params.id);
  if (!approval) throw httpError(404, 'Inventory approval was not found.');
  if (approval.status === 'rejected') return res.json({ success: true, message: 'This inventory adjustment was already rejected.', approval });
  if (approval.approvalLevel !== 'admin') {
    throw httpError(403, 'This adjustment requires the approved Owner authorization workflow.', 'OWNER_APPROVAL_REQUIRED');
  }
  if (approval.status !== 'pending') throw httpError(409, 'Only pending inventory adjustments can be rejected.');
  if (!canReviewInventoryApproval(approval, req.user)) {
    if (String(approval.requestedBy) === String(req.user._id)) {
      throw httpError(403, 'An Admin cannot reject their own inventory adjustment.', 'SELF_APPROVAL_FORBIDDEN');
    }
    throw httpError(403, 'This account cannot reject the inventory adjustment.');
  }
  const auditTarget = { targetType: 'inventory_approval', targetId: String(approval._id) };
  await AdminAudit.create({
    actor: req.user._id,
    action: 'inventory.approval.reject.started',
    reason: 'Administrator started an inventory adjustment rejection.',
    before: { status: 'pending' },
    after: { status: 'rejected' },
    metadata: { ...auditTarget, phase: 'intent' }
  });
  const rejected = await InventoryApproval.findOneAndUpdate(
    {
      _id: approval._id,
      status: 'pending',
      approvalLevel: 'admin',
      requestedBy: { $ne: req.user._id }
    },
    {
      $set: {
        status: 'rejected',
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        rejectionReason: reason
      }
    },
    { new: true, runValidators: true }
  );
  if (!rejected) throw httpError(409, 'This inventory approval was already reviewed.', 'APPROVAL_ALREADY_REVIEWED');
  await AdminAudit.create({
    actor: req.user._id,
    action: 'inventory.approval.reject',
    reason: 'Administrator rejected an inventory adjustment.',
    before: { status: 'pending' },
    after: { status: 'rejected' },
    metadata: { ...auditTarget, phase: 'completed' }
  });
  res.json({ success: true, message: 'Inventory adjustment rejected.', approval: rejected });
});

export const adjustInventory = asyncHandler(async (req, res) => {
  const adjustments = normalizeInventoryAdjustments(req.body?.adjustments);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 300) throw httpError(400, 'Provide an inventory adjustment reason between 5 and 300 characters.');
  const type = req.body?.type === undefined ? 'manual' : String(req.body.type).trim();
  if (!['manual', 'opening_stock', 'correction', 'damaged', 'lost', 'restock', 'return', 'purchase_receipt'].includes(type)) {
    throw httpError(400, 'Inventory adjustment type is invalid.');
  }
  if (['damaged', 'lost'].includes(type) && adjustments.some(({ delta }) => delta > 0)) {
    throw httpError(400, 'Damaged or lost stock adjustments must reduce on-hand stock.');
  }
  if (['opening_stock', 'restock', 'return', 'purchase_receipt'].includes(type) && adjustments.some(({ delta }) => delta < 0)) {
    throw httpError(400, 'Opening stock, returns, restock, and receipt adjustments must increase on-hand stock.');
  }
  if (req.body?.reference !== undefined && typeof req.body.reference !== 'string') {
    throw httpError(400, 'Inventory reference must be text.');
  }
  if (req.body?.notes !== undefined && typeof req.body.notes !== 'string') {
    throw httpError(400, 'Inventory notes must be text.');
  }
  const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim() : '';
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
  if (reference.length > 120 || notes.length > 1000) throw httpError(400, 'Inventory reference or notes exceed the allowed length.');
  if (req.body?.enhancedConfirmed !== undefined && typeof req.body.enhancedConfirmed !== 'boolean') {
    throw httpError(400, 'Enhanced inventory confirmation must be true or false.');
  }
  const enhancedConfirmed = req.body?.enhancedConfirmed === true;
  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
    throw httpError(400, 'A valid inventory request key is required.');
  }
  const policy = await InventoryPolicy.findOne({ scope: 'global' }).lean() || DEFAULT_INVENTORY_POLICY;
  let outcomes;
  try {
    outcomes = adjustments.map(({ delta }) => getInventoryAdjustmentOutcome(delta, policy, enhancedConfirmed));
  } catch (error) {
    throw httpError(500, 'The inventory approval policy is invalid and must be reviewed.', 'INVENTORY_POLICY_INVALID');
  }
  if (outcomes.includes('confirmation_required')) {
    throw httpError(400, 'Confirm this unusually large adjustment before it can be applied.', 'ENHANCED_CONFIRMATION_REQUIRED');
  }
  const approvalLevel = outcomes.includes('owner_approval')
    ? 'owner'
    : outcomes.includes('admin_approval') ? 'admin' : null;
  if (approvalLevel && adjustments.length !== 1) {
    throw httpError(400, 'Approval-required stock changes must be submitted one SKU or product at a time.', 'APPROVAL_SINGLE_ADJUSTMENT_REQUIRED');
  }
  const hash = inventoryAdjustmentRequestHash(adjustments, reason, {
    type,
    reference,
    notes,
    enhancedConfirmed,
    approvalLevel
  });

  const [existingMovement, existingApproval] = await Promise.all([
    StockMovement.findOne({ idempotencyKey }).select('+requestHash'),
    InventoryApproval.findOne({ idempotencyKey }).select('+requestHash')
  ]);
  const existingRequest = existingMovement || existingApproval;
  if (existingRequest) {
    if (existingRequest.requestHash !== hash) {
      throw httpError(409, 'This inventory request key was already used for a different adjustment.', 'IDEMPOTENCY_KEY_REUSED');
    }
    if (existingApproval) {
      return res.status(202).json({
        success: true,
        message: 'This inventory adjustment is awaiting approval.',
        approval: existingApproval
      });
    }
    if (existingMovement.status === 'rejected') {
      throw httpError(409, 'This inventory request was rejected and was not applied.', 'INVENTORY_ADJUSTMENT_REJECTED');
    }
    return res.json({ success: true, message: 'This inventory adjustment was already applied.', movement: existingMovement });
  }

  if (approvalLevel) {
    const adjustment = adjustments[0];
    const product = await Product.findOne(
      adjustment.sku ? { 'variants.sku': adjustment.sku } : { _id: adjustment.productId }
    ).select('name stock variants.sku variants.size variants.colour variants.stock variants.reservedQuantity').lean();
    if (!product) throw httpError(404, adjustment.sku ? 'An inventory SKU was not found.' : 'An inventory target was not found.');
    const variant = adjustment.sku
      ? product.variants.find((entry) => entry.sku === adjustment.sku)
      : null;
    if (adjustment.sku && !variant) throw httpError(404, 'An inventory SKU was not found.');
    try {
      calculateStockAfterAdjustment(
        variant?.stock ?? product.stock,
        adjustment.delta,
        variant?.reservedQuantity ?? 0
      );
    } catch (error) {
      throw httpError(409, `${error.message} (${adjustment.sku || product.name}).`);
    }
    let approval;
    try {
      approval = await InventoryApproval.create({
        product: product._id,
        productName: product.name,
        sku: variant?.sku,
        quantityDelta: adjustment.delta,
        type,
        approvalLevel,
        reason,
        reference,
        notes,
        status: 'pending',
        requestedBy: req.user._id,
        idempotencyKey,
        requestHash: hash
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      approval = await InventoryApproval.findOne({ idempotencyKey }).select('+requestHash');
      if (!approval) throw error;
      if (approval.requestHash !== hash) {
        throw httpError(409, 'This inventory request key was already used for a different adjustment.', 'IDEMPOTENCY_KEY_REUSED');
      }
    }
    const message = approvalLevel === 'owner'
      ? 'This inventory adjustment is pending Owner authorization; Admin accounts cannot approve it.'
      : 'Large inventory adjustment submitted for independent Admin approval.';
    return res.status(202).json({
      success: true,
      message,
      approval
    });
  }
  if (adjustments.length === 1) {
    const result = await applySingleInventoryAdjustment({
      adjustment: adjustments[0],
      reason,
      idempotencyKey,
      requestHash: hash,
      performedBy: req.user._id,
      type,
      reference,
      notes,
      enhancedConfirmed
    });
    if (result.replayed) {
      return res.json({ success: true, message: 'This inventory adjustment was already applied.', movement: result.movement });
    }
    return res.status(201).json({ success: true, message: 'Inventory adjustment saved.', movement: result.movement });
  }

  const existing = await StockMovement.findOne({ idempotencyKey }).select('+requestHash');
  if (existing) {
    if (existing.requestHash !== hash) throw httpError(409, 'This inventory request key was already used for a different adjustment.', 'IDEMPOTENCY_KEY_REUSED');
    if (existing.status === 'rejected') throw httpError(409, 'This inventory request was rejected and was not applied.', 'INVENTORY_ADJUSTMENT_REJECTED');
    return res.json({ success: true, message: 'This inventory adjustment was already applied.', movement: existing });
  }
  if (!supportsMongoTransactions()) {
    throw httpError(503, 'Bulk inventory adjustments require MongoDB replica-set or sharded transactions. Apply each item separately on this standalone database.', 'TRANSACTIONS_REQUIRED');
  }

  const session = await mongoose.startSession();
  let movement;
  try {
    await session.withTransaction(async () => {
      const changes = [];
      for (const adjustment of adjustments) {
        const filter = adjustment.sku
          ? { 'variants.sku': adjustment.sku }
          : { _id: adjustment.productId };
        const product = await Product.findOne(filter).session(session);
        if (!product) throw httpError(404, 'An inventory target was not found.');

        const variant = adjustment.sku
          ? product.variants.find((entry) => entry.sku === adjustment.sku)
          : null;
        if (adjustment.sku && !variant) throw httpError(404, 'An inventory SKU was not found.');
        const stockBefore = variant?.stock ?? product.stock;
        let stockAfter;
        try {
          stockAfter = calculateStockAfterAdjustment(
            stockBefore,
            adjustment.delta,
            variant?.reservedQuantity ?? 0
          );
        } catch (error) {
          throw httpError(409, `${error.message} (${adjustment.sku || product.name}).`);
        }

        let update;
        let updateFilter;
        if (variant) {
          const mutation = buildVariantStockAdjustment(variant.sku, Math.abs(adjustment.delta), adjustment.delta < 0 ? 'decrease' : 'increase');
          update = mutation.update;
          updateFilter = {
            _id: product._id,
            stock: adjustment.delta < 0 ? { $gte: Math.abs(adjustment.delta) } : { $lte: Number.MAX_SAFE_INTEGER - adjustment.delta },
            variants: {
              $elemMatch: {
                ...mutation.filter,
                $or: [
                  { reservedQuantity: { $lte: stockAfter } },
                  { reservedQuantity: { $exists: false } }
                ]
              }
            }
          };
        } else {
          update = { $inc: { stock: adjustment.delta } };
          updateFilter = {
            _id: product._id,
            stock: adjustment.delta < 0 ? { $gte: Math.abs(adjustment.delta) } : { $lte: Number.MAX_SAFE_INTEGER - adjustment.delta }
          };
        }

        const result = await Product.updateOne(updateFilter, update, { session });
        if (!result.matchedCount) throw httpError(409, `Inventory changed while processing ${adjustment.sku || product.name}. Retry the adjustment.`);
        changes.push({
          product: product._id,
          productName: product.name,
          sku: variant?.sku,
          size: variant?.size || '',
          colour: variant?.colour || '',
          quantityDelta: adjustment.delta,
          stockBefore,
          stockAfter
        });
      }

      [movement] = await StockMovement.create([{
        changes,
        reason,
        type,
        idempotencyKey,
        requestHash: hash,
        enhancedConfirmed,
        reference,
        notes,
        performedBy: req.user._id
      }], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await StockMovement.findOne({ idempotencyKey }).select('+requestHash');
      if (prior?.requestHash === hash) return res.json({ success: true, message: 'This inventory adjustment was already applied.', movement: prior });
      if (prior) throw httpError(409, 'This inventory request key was already used for a different adjustment.', 'IDEMPOTENCY_KEY_REUSED');
    }
    throw error;
  } finally {
    await session.endSession();
  }
  res.status(201).json({ success: true, message: 'Inventory adjustment saved.', movement });
});
