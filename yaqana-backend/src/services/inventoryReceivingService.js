import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import InventoryInbound from '../models/InventoryInbound.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import { httpError } from '../utils/http.js';
import { supportsMongoTransactions } from '../utils/mongoTransactions.js';
import {
  calculateWeightedAverageCost,
  getInboundRemaining,
  normalizeInboundReceipt
} from '../utils/inventoryReceiving.js';

const hashRequest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const movementKeyForReceipt = (receiptId, idempotencyKey) =>
  `receipt-${hashRequest({ receiptId: String(receiptId), idempotencyKey })}`;

export async function receiveInventoryInbound({ receiptId, idempotencyKey, input, performedBy }) {
  if (!mongoose.isValidObjectId(receiptId)) throw httpError(400, 'Inbound receipt ID is invalid.');
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
    throw httpError(400, 'A valid inbound receipt request key is required.');
  }
  if (!supportsMongoTransactions()) {
    throw httpError(
      503,
      'Receiving stock requires MongoDB replica-set or sharded transactions. No receipt or stock data was changed.',
      'TRANSACTIONS_REQUIRED'
    );
  }

  const session = await mongoose.startSession();
  let outcome;
  try {
    await session.withTransaction(async () => {
      const receipt = await InventoryInbound.findById(receiptId).session(session);
      if (!receipt) throw httpError(404, 'Inbound receipt was not found.');

      const previousEvent = receipt.receiveHistory.find((event) => event.idempotencyKey === idempotencyKey);
      if (previousEvent) {
        const replayData = normalizeInboundReceipt(input, receipt.expectedQuantity);
        const unitCostPaise = replayData.unitCostPaise ?? receipt.unitCostPaise ?? null;
        const requestHash = hashRequest({ ...replayData, unitCostPaise });
        if (previousEvent.requestHash !== requestHash) {
          throw httpError(409, 'This inbound receipt request key was already used for different quantities.', 'IDEMPOTENCY_KEY_REUSED');
        }
        outcome = { receipt, event: previousEvent, replayed: true };
        return;
      }
      if (receipt.status !== 'open') throw httpError(409, 'Only open inbound receipts can be received.');

      const remaining = getInboundRemaining(receipt);
      const quantities = normalizeInboundReceipt(input, remaining);
      const unitCostPaise = quantities.unitCostPaise ?? receipt.unitCostPaise ?? null;
      const requestHash = hashRequest({ ...quantities, unitCostPaise });
      const product = await Product.findById(receipt.product).session(session);
      if (!product) throw httpError(404, 'The product linked to this receipt was not found.');

      const variant = receipt.sku
        ? product.variants.find((entry) => entry.sku === receipt.sku)
        : null;
      if (receipt.sku && !variant) throw httpError(409, 'The SKU linked to this receipt no longer exists.');
      if (!receipt.sku && product.variants.length) {
        throw httpError(409, 'This product has SKU variants; receive stock against a specific SKU.');
      }

      let movement = null;
      if (quantities.receivedQuantity > 0) {
        const stockBefore = variant?.stock ?? product.stock;
        const stockAfter = stockBefore + quantities.receivedQuantity;
        if (!Number.isSafeInteger(stockBefore) || !Number.isSafeInteger(stockAfter)) {
          throw httpError(409, 'The receipt would exceed the safe stock quantity range.');
        }
        const cost = variant
          ? calculateWeightedAverageCost({
            onHand: stockBefore,
            costedQuantity: variant.costedQuantity ?? 0,
            unitCostPaise: variant.unitCostPaise ?? null
          }, quantities.receivedQuantity, unitCostPaise)
          : null;

        const filter = variant
          ? {
            _id: product._id,
            stock: product.stock,
            variants: {
              $elemMatch: {
                sku: variant.sku,
                stock: variant.stock,
                $or: [
                  { reservedQuantity: variant.reservedQuantity ?? 0 },
                  { reservedQuantity: { $exists: false } }
                ]
              }
            }
          }
          : { _id: product._id, stock: product.stock };
        const update = variant
          ? {
            $inc: {
              stock: quantities.receivedQuantity,
              'variants.$.stock': quantities.receivedQuantity
            },
            $set: {
              'variants.$.unitCostPaise': cost.unitCostPaise,
              'variants.$.costedQuantity': cost.costedQuantity
            }
          }
          : { $inc: { stock: quantities.receivedQuantity } };
        const updateResult = await Product.updateOne(filter, update, { session });
        if (!updateResult.matchedCount) {
          throw httpError(409, 'Inventory changed while receiving this purchase. Refresh and retry.');
        }

        const movementIdempotencyKey = movementKeyForReceipt(receipt._id, idempotencyKey);
        const [createdMovement] = await StockMovement.create([{
          changes: [{
            product: product._id,
            productName: product.name,
            sku: variant?.sku,
            size: variant?.size || '',
            colour: variant?.colour || '',
            quantityDelta: quantities.receivedQuantity,
            stockBefore,
            stockAfter
          }],
          reason: `Received inbound stock${receipt.reference ? `: ${receipt.reference}` : ''}`,
          type: 'purchase_receipt',
          status: 'applied',
          referenceId: receipt._id,
          reference: receipt.reference,
          idempotencyKey: movementIdempotencyKey,
          requestHash,
          performedBy
        }], { session });
        movement = createdMovement;
      }

      receipt.receivedQuantity += quantities.receivedQuantity;
      receipt.damagedQuantity += quantities.damagedQuantity;
      receipt.rejectedQuantity += quantities.rejectedQuantity;
      receipt.cancelledQuantity += quantities.cancelledQuantity;
      receipt.updatedBy = performedBy;
      const event = {
        idempotencyKey,
        requestHash,
        ...quantities,
        unitCostPaise,
        performedBy,
        movementId: movement?._id || null,
        receivedAt: new Date()
      };
      receipt.receiveHistory.push(event);
      if (getInboundRemaining(receipt) === 0) receipt.status = 'closed';
      await receipt.save({ session });
      outcome = { receipt, event, movement, replayed: false };
    });
  } finally {
    await session.endSession();
  }
  return outcome;
}

export { hashRequest as inventoryReceiptRequestHash };
