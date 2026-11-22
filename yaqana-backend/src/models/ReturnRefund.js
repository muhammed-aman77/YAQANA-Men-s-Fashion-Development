import mongoose from 'mongoose';

const returnRefundSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requestType: { type: String, enum: ['return', 'exchange', 'refund'], required: true },
  status: { type: String, enum: ['Requested', 'Inspected', 'Approved', 'Rejected', 'Exchange Ready', 'Refund Pending', 'Refunded', 'Cancelled'], default: 'Requested', index: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  evidence: { type: String, trim: true, maxlength: 500, default: '' },
  amountPaise: { type: Number, min: 0, validate: Number.isSafeInteger, default: 0 },
  refundEvidence: { type: String, trim: true, maxlength: 500, default: '' },
  idempotencyKey: { type: String, required: true, select: false },
  history: [{
    status: String,
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, trim: true, maxlength: 500 },
    at: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

returnRefundSchema.index({ order: 1, idempotencyKey: 1 }, { unique: true });

export default mongoose.model('ReturnRefund', returnRefundSchema);
