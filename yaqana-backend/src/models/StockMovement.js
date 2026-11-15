import mongoose from 'mongoose';

const changeSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true, maxlength: 200 },
  sku: { type: String, uppercase: true, trim: true, maxlength: 48, default: undefined },
  size: { type: String, maxlength: 30, default: '' },
  colour: { type: String, maxlength: 50, default: '' },
  quantityDelta: { type: Number, required: true, validate: Number.isSafeInteger },
  stockBefore: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  stockAfter: { type: Number, required: true, min: 0, validate: Number.isSafeInteger }
}, { _id: false });

const schema = new mongoose.Schema({
  changes: { type: [changeSchema], required: true, validate: (changes) => changes.length > 0 },
  reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 300 },
  type: { type: String, enum: ['manual', 'order', 'order_cancel', 'purchase_receipt', 'return'], required: true },
  status: { type: String, enum: ['pending', 'applying', 'applied', 'rejected'], default: 'applied' },
  referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  idempotencyKey: { type: String, trim: true, default: undefined },
  requestHash: { type: String, select: false, default: undefined },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

schema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
schema.index({ 'changes.product': 1, createdAt: -1 });
schema.index({ 'changes.sku': 1, createdAt: -1 });
schema.index({ referenceId: 1, type: 1 });

export default mongoose.model('StockMovement', schema);
