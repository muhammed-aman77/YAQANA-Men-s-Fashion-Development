import mongoose from 'mongoose';

const receiveEventSchema = new mongoose.Schema({
  idempotencyKey: { type: String, required: true, trim: true, maxlength: 100 },
  requestHash: { type: String, required: true, match: /^[a-f\d]{64}$/i },
  receivedQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  damagedQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  rejectedQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  cancelledQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  unitCostPaise: { type: Number, default: null, min: 0, validate: (value) => value == null || Number.isSafeInteger(value) },
  cancellationReason: { type: String, trim: true, maxlength: 300, default: '' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  movementId: { type: mongoose.Schema.Types.ObjectId, ref: 'StockMovement', default: null },
  receivedAt: { type: Date, required: true, default: Date.now }
}, { _id: true });

const schema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  sku: { type: String, trim: true, uppercase: true, maxlength: 48, default: undefined },
  expectedDate: { type: Date, default: null },
  expectedQuantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  receivedQuantity: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  damagedQuantity: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  rejectedQuantity: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  cancelledQuantity: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  receiveHistory: { type: [receiveEventSchema], default: [] },
  reference: { type: String, trim: true, maxlength: 120, default: '' },
  unitCostPaise: { type: Number, default: null, min: 0, validate: (value) => value == null || Number.isSafeInteger(value) },
  status: { type: String, enum: ['open', 'closed', 'cancelled'], default: 'open', index: true },
  idempotencyKey: { type: String, trim: true, default: undefined },
  requestHash: { type: String, select: false, match: /^[a-f\d]{64}$/i, default: undefined },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true, collection: 'inventoryinbounds' });

schema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
schema.index({ product: 1, sku: 1, status: 1 });
schema.index({ status: 1, expectedDate: 1 });

schema.pre('validate', function validateReceiptBalance() {
  const accounted = this.receivedQuantity + this.damagedQuantity + this.rejectedQuantity + this.cancelledQuantity;
  if (accounted > this.expectedQuantity) {
    this.invalidate('expectedQuantity', 'Recorded receipt quantities cannot exceed the expected quantity.');
  }
  if (this.status === 'closed' && accounted < this.expectedQuantity) {
    this.invalidate('status', 'A receipt can only close after all expected units are accounted for.');
  }
});

export default mongoose.model('InventoryInbound', schema);
