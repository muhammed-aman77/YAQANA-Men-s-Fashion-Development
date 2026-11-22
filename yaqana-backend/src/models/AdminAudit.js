import mongoose from 'mongoose';

const adminAuditSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, required: true, trim: true, maxlength: 100, index: true },
  target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 500 },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  immutable: { type: Boolean, default: true, immutable: true }
}, { timestamps: true });

adminAuditSchema.index({ createdAt: -1 });
adminAuditSchema.index({ action: 1, createdAt: -1 });

export default mongoose.model('AdminAudit', adminAuditSchema);
