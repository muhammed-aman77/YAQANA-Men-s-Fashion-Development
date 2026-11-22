import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  scope: { type: String, enum: ['global'], required: true, unique: true, default: 'global' },
  lowStockThreshold: { type: Number, required: true, min: 0, default: 10, validate: Number.isSafeInteger },
  criticalStockThreshold: { type: Number, required: true, min: 0, default: 3, validate: Number.isSafeInteger },
  normalAdjustmentLimit: { type: Number, required: true, min: 1, default: 10, validate: Number.isSafeInteger },
  enhancedConfirmationLimit: { type: Number, required: true, min: 1, default: 25, validate: Number.isSafeInteger },
  adminApprovalLimit: { type: Number, required: true, min: 1, default: 50, validate: Number.isSafeInteger },
  prepaidReservationTtlMinutes: { type: Number, required: true, min: 1, default: 15, validate: Number.isSafeInteger }
}, { timestamps: true, collection: 'inventorypolicies' });

schema.pre('validate', function validateInventoryLimits() {
  if (this.criticalStockThreshold > this.lowStockThreshold) {
    this.invalidate('criticalStockThreshold', 'Critical stock must not exceed the low-stock threshold.');
  }
  if (!(this.normalAdjustmentLimit < this.enhancedConfirmationLimit &&
    this.enhancedConfirmationLimit < this.adminApprovalLimit)) {
    this.invalidate('normalAdjustmentLimit', 'Inventory approval thresholds must be strictly increasing.');
  }
});

export default mongoose.model('InventoryPolicy', schema);
