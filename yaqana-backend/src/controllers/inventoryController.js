import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import { asyncHandler, httpError } from '../utils/http.js';
import { normalizeInventoryAdjustments } from '../utils/inventoryAdjustments.js';
import { buildVariantStockAdjustment } from '../utils/variantInventory.js';
import { supportsMongoTransactions } from '../utils/mongoTransactions.js';
import { applySingleInventoryAdjustment } from '../services/inventoryAdjustmentService.js';

const LOW_STOCK_THRESHOLD = 10;
const requestHash = (adjustments, reason) => createHash('sha256')
  .update(JSON.stringify({ adjustments, reason }))
  .digest('hex');

export const getInventory = asyncHandler(async (_req, res) => {
  const products = await Product.find({}).select('name category active stock variants').sort({ name: 1 }).lean();
  const items = products.flatMap((product) => {
    const rows = product.variants?.length
      ? product.variants.map((variant) => ({ ...variant, productId: product._id, productName: product.name, category: product.category }))
      : [{ productId: product._id, productName: product.name, category: product.category, sku: null, size: '', colour: '', stock: product.stock }];
    return rows.map((item) => ({
      ...item,
      active: product.active !== false,
      status: item.stock <= 0 ? 'out_of_stock' : item.stock <= LOW_STOCK_THRESHOLD ? 'low_stock' : 'in_stock'
    }));
  });
  const summary = {
    totalProducts: new Set(items.map((item) => String(item.productId))).size,
    stockRecords: items.length,
    unitsOnHand: items.reduce((total, item) => total + item.stock, 0),
    lowStockRecords: items.filter((item) => item.status === 'low_stock').length,
    outOfStockRecords: items.filter((item) => item.status === 'out_of_stock').length
  };
  res.json({ success: true, inventory: items, lowStockThreshold: LOW_STOCK_THRESHOLD, summary });
});

export const getInventoryMovements = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const query = {};
  if (req.query.productId) {
    if (!mongoose.isValidObjectId(req.query.productId)) throw httpError(400, 'Product ID is invalid.');
    query['changes.product'] = req.query.productId;
  }
  if (req.query.sku) query['changes.sku'] = String(req.query.sku).trim().toUpperCase();
  query.status = { $nin: ['pending', 'applying', 'rejected'] };
  const [movements, totalCount] = await Promise.all([
    StockMovement.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('performedBy', 'name email'),
    StockMovement.countDocuments(query)
  ]);
  res.json({ success: true, movements, totalCount, currentPage: page, totalPages: Math.ceil(totalCount / limit) });
});

export const adjustInventory = asyncHandler(async (req, res) => {
  const adjustments = normalizeInventoryAdjustments(req.body?.adjustments);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 300) throw httpError(400, 'Provide an inventory adjustment reason between 5 and 300 characters.');
  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
    throw httpError(400, 'A valid inventory request key is required.');
  }
  const hash = requestHash(adjustments, reason);
  if (adjustments.length === 1) {
    const result = await applySingleInventoryAdjustment({
      adjustment: adjustments[0],
      reason,
      idempotencyKey,
      requestHash: hash,
      performedBy: req.user._id
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
        const stockAfter = stockBefore + adjustment.delta;
        if (!Number.isSafeInteger(stockAfter) || stockAfter < 0) {
          throw httpError(409, `The adjustment would make stock invalid for ${adjustment.sku || product.name}.`);
        }

        let update;
        let updateFilter;
        if (variant) {
          const mutation = buildVariantStockAdjustment(variant.sku, Math.abs(adjustment.delta), adjustment.delta < 0 ? 'decrease' : 'increase');
          update = mutation.update;
          updateFilter = {
            _id: product._id,
            stock: adjustment.delta < 0 ? { $gte: Math.abs(adjustment.delta) } : { $lte: Number.MAX_SAFE_INTEGER - adjustment.delta },
            variants: { $elemMatch: mutation.filter }
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
        type: 'manual',
        idempotencyKey,
        requestHash: hash,
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
