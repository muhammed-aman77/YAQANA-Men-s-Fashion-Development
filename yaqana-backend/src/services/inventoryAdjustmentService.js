import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import { httpError } from '../utils/http.js';
import { buildVariantStockAdjustment } from '../utils/variantInventory.js';

const findProductForAdjustment = ({ sku, productId }) => sku
  ? Product.findOne({ 'variants.sku': sku })
  : Product.findById(productId);

const releaseInventoryLock = (productId, movementId) => Product.updateOne(
  { _id: productId, inventoryLock: movementId },
  { $unset: { inventoryLock: 1 } }
);

const rejectMovement = async (movement, productId, error) => {
  movement.status = 'rejected';
  await movement.save();
  await releaseInventoryLock(productId, movement._id);
  throw error;
};

async function applyPendingMovement(movement) {
  const change = movement.changes[0];
  const productId = change.product;
  const lock = await Product.updateOne({
    _id: productId,
    $or: [{ inventoryLock: { $exists: false } }, { inventoryLock: movement._id }]
  }, { $set: { inventoryLock: movement._id } });

  if (!lock.matchedCount) {
    const currentProduct = await Product.findById(productId).select('+inventoryLock');
    if (!currentProduct) return rejectMovement(movement, productId, httpError(404, 'An inventory target was not found.'));
    const lockOwnerId = currentProduct.inventoryLock;
    if (lockOwnerId && String(lockOwnerId) !== String(movement._id)) {
      const lockOwner = await StockMovement.findById(lockOwnerId).select('+requestHash');
      if (lockOwner && ['pending', 'applying'].includes(lockOwner.status)) {
        await applyPendingMovement(lockOwner);
        return applyPendingMovement(movement);
      }
      if (lockOwner) await releaseInventoryLock(productId, lockOwner._id);
    }
    throw httpError(409, 'Another inventory adjustment is processing for this product. Retry the same request.', 'INVENTORY_ADJUSTMENT_IN_PROGRESS');
  }

  const product = await Product.findOne({ _id: productId, inventoryLock: movement._id })
    .select('+inventoryLock +lastInventoryMovement');
  if (!product) return rejectMovement(movement, productId, httpError(404, 'An inventory target was not found.'));

  if (String(product.lastInventoryMovement || '') === String(movement._id)) {
    movement.status = 'applied';
    await movement.save();
    await releaseInventoryLock(productId, movement._id);
    return { movement, replayed: true };
  }

  const variant = change.sku
    ? product.variants.find((entry) => entry.sku === change.sku)
    : null;
  if (change.sku && !variant) {
    return rejectMovement(movement, productId, httpError(404, 'An inventory SKU was not found.'));
  }

  const stockBefore = variant?.stock ?? product.stock;
  const stockAfter = stockBefore + change.quantityDelta;
  if (!Number.isSafeInteger(stockBefore) || !Number.isSafeInteger(stockAfter) || stockAfter < 0) {
    change.productName = product.name;
    change.stockBefore = stockBefore;
    change.stockAfter = stockBefore;
    movement.status = 'rejected';
    await movement.save();
    await releaseInventoryLock(productId, movement._id);
    throw httpError(409, `The adjustment would make stock invalid for ${change.sku || product.name}.`);
  }

  change.productName = product.name;
  change.size = variant?.size || '';
  change.colour = variant?.colour || '';
  change.stockBefore = stockBefore;
  change.stockAfter = stockAfter;
  movement.status = 'applying';
  await movement.save();

  let filter;
  let update;
  if (variant) {
    const mutation = buildVariantStockAdjustment(
      variant.sku,
      Math.abs(change.quantityDelta),
      change.quantityDelta < 0 ? 'decrease' : 'increase'
    );
    const variantStock = change.quantityDelta < 0
      ? { $gte: Math.abs(change.quantityDelta) }
      : { $lte: Number.MAX_SAFE_INTEGER - change.quantityDelta };
    filter = {
      _id: productId,
      inventoryLock: movement._id,
      lastInventoryMovement: { $ne: movement._id },
      stock: change.quantityDelta < 0
        ? { $gte: Math.abs(change.quantityDelta) }
        : { $lte: Number.MAX_SAFE_INTEGER - change.quantityDelta },
      variants: { $elemMatch: { sku: variant.sku, stock: variantStock } }
    };
    update = {
      ...mutation.update,
      $set: { lastInventoryMovement: movement._id }
    };
  } else {
    filter = {
      _id: productId,
      inventoryLock: movement._id,
      lastInventoryMovement: { $ne: movement._id },
      stock: change.quantityDelta < 0
        ? { $gte: Math.abs(change.quantityDelta) }
        : { $lte: Number.MAX_SAFE_INTEGER - change.quantityDelta }
    };
    update = {
      $inc: { stock: change.quantityDelta },
      $set: { lastInventoryMovement: movement._id }
    };
  }

  const result = await Product.updateOne(filter, update);
  if (!result.matchedCount) {
    const latest = await Product.findById(productId).select('+inventoryLock +lastInventoryMovement');
    if (String(latest?.lastInventoryMovement || '') !== String(movement._id)) {
      return rejectMovement(movement, productId, httpError(409, `Inventory changed while processing ${change.sku || product.name}. Retry the adjustment.`));
    }
  }

  movement.status = 'applied';
  await movement.save();
  await releaseInventoryLock(productId, movement._id);
  return { movement, replayed: false };
}

export async function applySingleInventoryAdjustment({ adjustment, reason, idempotencyKey, requestHash, performedBy }) {
  let movement = await StockMovement.findOne({ idempotencyKey }).select('+requestHash');
  if (movement && movement.requestHash !== requestHash) {
    throw httpError(409, 'This inventory request key was already used for a different adjustment.', 'IDEMPOTENCY_KEY_REUSED');
  }
  if (movement?.status === 'rejected') {
    await releaseInventoryLock(movement.changes[0].product, movement._id);
    throw httpError(409, 'This inventory request was rejected and was not applied.', 'INVENTORY_ADJUSTMENT_REJECTED');
  }
  if (movement?.status === 'applied') {
    await releaseInventoryLock(movement.changes[0].product, movement._id);
    return { movement, replayed: true };
  }

  if (!movement) {
    const product = await findProductForAdjustment(adjustment);
    if (!product) throw httpError(404, adjustment.sku ? 'An inventory SKU was not found.' : 'An inventory target was not found.');
    const variant = adjustment.sku
      ? product.variants.find((entry) => entry.sku === adjustment.sku)
      : null;
    if (adjustment.sku && !variant) throw httpError(404, 'An inventory SKU was not found.');

    try {
      [movement] = await StockMovement.create([{
        changes: [{
          product: product._id,
          productName: product.name,
          sku: variant?.sku,
          size: variant?.size || '',
          colour: variant?.colour || '',
          quantityDelta: adjustment.delta,
          stockBefore: 0,
          stockAfter: 0
        }],
        reason,
        type: 'manual',
        status: 'pending',
        idempotencyKey,
        requestHash,
        performedBy
      }]);
    } catch (error) {
      if (error.code !== 11000) throw error;
      movement = await StockMovement.findOne({ idempotencyKey }).select('+requestHash');
      if (!movement) throw error;
      if (movement.requestHash !== requestHash) {
        throw httpError(409, 'This inventory request key was already used for a different adjustment.', 'IDEMPOTENCY_KEY_REUSED');
      }
      if (movement.status === 'applied') return { movement, replayed: true };
      if (movement.status === 'rejected') throw httpError(409, 'This inventory request was rejected and was not applied.', 'INVENTORY_ADJUSTMENT_REJECTED');
    }
  }

  return applyPendingMovement(movement);
}
