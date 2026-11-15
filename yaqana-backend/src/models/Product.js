import mongoose from 'mongoose';
import { paiseToCatalogUnits } from '../utils/money.js';

const colourSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 50 },
  hex: { type: String, default: '#D4C5B9', match: /^#[0-9A-Fa-f]{6}$/ },
  images: { type: [String], default: [] }
}, { _id: false });

const variantSchema = new mongoose.Schema({
  size: { type: String, required: true, trim: true, maxlength: 30 },
  colour: { type: String, required: true, trim: true, maxlength: 50 },
  sku: { type: String, required: true, uppercase: true, trim: true, maxlength: 48, match: /^[A-Z0-9][A-Z0-9._-]{1,47}$/ },
  stock: { type: Number, required: true, min: 0, validate: Number.isSafeInteger }
}, { _id: false });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  slug: { type: String, required: true, lowercase: true, trim: true, unique: true },
  description: { type: String, required: true, trim: true },
  shortDescription: { type: String, trim: true, maxlength: 300, default: '' },
  category: { type: String, required: true, trim: true, maxlength: 100 },
  gender: { type: String, enum: ['men', 'women', 'unisex'], default: 'men' },
  pricePaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  discountPricePaise: { type: Number, default: null, min: 0, validate: (value) => value == null || Number.isSafeInteger(value) },
  sizes: { type: [String], default: [] },
  colours: { type: [colourSchema], default: [] },
  variants: { type: [variantSchema], default: [] },
  stock: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  inventoryLock: { type: mongoose.Schema.Types.ObjectId, default: undefined, select: false },
  lastInventoryMovement: { type: mongoose.Schema.Types.ObjectId, default: undefined, select: false },
  images: { type: [String], default: [] },
  status: { type: String, enum: ['draft', 'active', 'archived', 'discontinued', null], default: null },
  featured: { type: Boolean, default: false },
  newArrival: { type: Boolean, default: false },
  bestSeller: { type: Boolean, default: false },
  fabricDetails: { type: String, trim: true, default: '' },
  fitDetails: { type: String, trim: true, default: '' },
  careInstructions: { type: String, trim: true, default: '' },
  collectionName: { type: String, trim: true, default: '' },
  measurements: { type: mongoose.Schema.Types.Mixed, default: undefined },
  shippingDetails: { type: String, trim: true, default: '' },
  active: { type: Boolean, default: true }
}, {
  timestamps: true,
  toJSON: { virtuals: true, transform(_doc, ret) {
    // Compatibility adapter for the unchanged storefront, which currently reads legacy catalogue-unit `price` fields.
    ret.price = paiseToCatalogUnits(ret.pricePaise);
    ret.discountPrice = ret.discountPricePaise == null ? null : paiseToCatalogUnits(ret.discountPricePaise);
    ret.collection = ret.collectionName;
    delete ret.__v;
    return ret;
  } },
  toObject: { virtuals: true }
});

productSchema.pre('validate', function deriveAggregateStock() {
  if (this.variants.length) this.stock = this.variants.reduce((total, variant) => total + variant.stock, 0);
  if (this.isModified('status') && this.status) {
    this.active = this.status === 'active';
  } else if (this.isNew || this.isModified('active')) {
    this.status = this.active ? 'active' : 'archived';
  }
});

productSchema.index({ name: 'text', description: 'text', category: 'text' });
productSchema.index({ active: 1, gender: 1, category: 1, createdAt: -1 });
productSchema.index({ active: 1, newArrival: 1, createdAt: -1 });
productSchema.index({ collectionName: 1, active: 1 });
productSchema.index({ 'variants.sku': 1 }, { unique: true, sparse: true });
export default mongoose.model('Product', productSchema);
