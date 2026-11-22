import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true, trim: true, maxlength: 200 },
  sku: { type: String, uppercase: true, trim: true, maxlength: 48, default: undefined },
  quantityDelta: {
    type: Number,
    required: true,
    validate: (value) => Number.isSafeInteger(value) && value !== 0 && Math.abs(value) <= 100000
  },
  type: {
    type: String,
    enum: ['manual', 'opening_stock', 'correction', 'damaged', 'lost', 'return', 'restock', 'purchase_receipt'],
    required: true
  },
  approvalLevel: { type: String, enum: ['admin', 'owner'], required: true },
  reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 300 },
  reference: { type: String, trim: true, maxlength: 120, default: '' },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'applied', 'rejected'], default: 'pending' },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  approvedAt: { type: Date, default: null },
  rejectionReason: { type: String, trim: true, maxlength: 300, default: '' },
  appliedAt: { type: Date, default: null },
  movementId: { type: mongoose.Schema.Types.ObjectId, ref: 'StockMovement', default: null },
  idempotencyKey: { type: String, required: true, trim: true, maxlength: 100 },
  requestHash: { type: String, required: true, select: false, match: /^[a-f\d]{64}$/i }
}, { timestamps: true, collection: 'inventoryapprovals' });

schema.index({ idempotencyKey: 1 }, { unique: true });
schema.index({ status: 1, approvalLevel: 1, createdAt: -1 });
schema.index({ product: 1, sku: 1, createdAt: -1 });

export default mongoose.model('InventoryApproval', schema);
