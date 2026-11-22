import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  productName: { type: String, required: true, maxlength: 200 },
  productSlug: { type: String, required: true, maxlength: 220 },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  deletedAt: { type: Date, required: true, default: Date.now }
}, { versionKey: false });

schema.index({ performedBy: 1, deletedAt: -1 });

export default mongoose.model('ProductDeletionAudit', schema);
