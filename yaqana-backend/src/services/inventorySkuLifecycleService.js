import { httpError } from '../utils/http.js';
import { supportsMongoTransactions } from '../utils/mongoTransactions.js';

export async function restoreInventorySku({
  productId,
  sku,
  actorId,
  reason,
  connection,
  startSession,
  ProductModel,
  AdminAuditModel
}) {
  if (!supportsMongoTransactions(connection)) {
    throw httpError(503, 'Restoring an SKU requires MongoDB transaction support.', 'TRANSACTIONS_REQUIRED');
  }

  const normalizedSku = String(sku || '').trim().toUpperCase();
  const normalizedReason = String(reason || '').trim();
  if (!normalizedSku || normalizedReason.length < 5 || normalizedReason.length > 500 || !actorId) {
    throw httpError(400, 'A valid SKU, administrator, and audit reason are required.');
  }

  const session = await startSession();
  let restored;
  try {
    await session.withTransaction(async () => {
      const product = await ProductModel.findById(productId).session(session);
      if (!product) throw httpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
      const variant = product.variants.find((entry) => entry.sku === normalizedSku);
      if (!variant) throw httpError(404, 'SKU not found for this product.', 'SKU_NOT_FOUND');
      const previousStatus = variant.status || 'active';
      if (previousStatus === 'active') {
        throw httpError(409, 'This SKU is already active.', 'SKU_ALREADY_ACTIVE');
      }
      if (!['inactive', 'discontinued'].includes(previousStatus)) {
        throw httpError(409, 'This SKU cannot be restored from its current lifecycle state.', 'SKU_NOT_RESTORABLE');
      }

      variant.status = 'active';
      await product.save({ session });
      await AdminAuditModel.create([{
        actor: actorId,
        action: 'inventory.sku.restore',
        reason: normalizedReason,
        before: { status: previousStatus },
        after: { status: 'active' },
        metadata: {
          productId: String(product._id),
          productName: product.name,
          sku: variant.sku,
          size: variant.size,
          colour: variant.colour
        }
      }], { session });
      restored = {
        productId: String(product._id),
        productName: product.name,
        sku: variant.sku,
        size: variant.size,
        colour: variant.colour,
        variantStatus: variant.status
      };
    });
  } finally {
    await session.endSession();
  }

  return restored;
}
