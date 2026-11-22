import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Collection from '../models/Collection.js';
import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import ProductDeletionAudit from '../models/ProductDeletionAudit.js';
import AdminAudit from '../models/AdminAudit.js';
import StockMovement from '../models/StockMovement.js';
import Wishlist from '../models/Wishlist.js';
import { asyncHandler, httpError, slugify } from '../utils/http.js';
import { catalogUnitsToPaise } from '../utils/money.js';
import { buildEffectivePriceFilter } from '../utils/effectivePriceFilter.js';
import { supportsMongoTransactions } from '../utils/mongoTransactions.js';
import { assertVariantInventoryUnchanged, isValidProductImageUrl, validateVariantMatrix } from '../utils/productVariants.js';
import { getProductCompletenessIssues } from '../utils/productCompleteness.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAdmin = (req) => ['admin', 'owner'].includes(req.user?.role) && Boolean(req.session?.mfaVerifiedAt);
const requiredCategorySlugs = new Set(['t-shirts', 'hoodies', 'shirts', 'trousers']);
const PRODUCT_STATUSES = new Set(['draft', 'active', 'archived', 'discontinued']);
const auditProductState = (product) => ({
  name: product.name, slug: product.slug, category: product.category, collectionName: product.collectionName,
  status: product.status, active: product.active, pricePaise: product.pricePaise,
  discountPricePaise: product.discountPricePaise, sizes: product.sizes,
  colours: (product.colours || []).map(({ name, hex }) => ({ name, hex })),
  variants: (product.variants || []).map(({ size, colour, sku, pricePaise }) => ({ size, colour, sku, pricePaise })),
  imageCount: product.images?.length || 0,
  colourGalleryImageCount: (product.colours || []).reduce((count, colour) => count + (colour.images?.length || 0), 0),
  mediaFingerprint: createHash('sha256')
    .update([...(product.images || []), ...(product.colours || []).flatMap((colour) => colour.images || [])].join('\n'))
    .digest('hex')
});
const startCatalogAudit = (req, action, target, before, after, metadata = {}) => AdminAudit.create({
  actor: req.user._id, action: `${action}.started`, target: null,
  reason: `Administrator started catalog operation ${action}.`, before: before || null,
  after: after || null,
  metadata: { targetId: target ? String(target) : null, ...metadata, phase: 'intent' }
});
const logCatalogAudit = (req, action, target, before, after, metadata = {}) => AdminAudit.create({
  actor: req.user._id, action, target: null, reason: `Admin catalog operation: ${action}`,
  before: before || null, after: after || null, metadata: { targetId: String(target), ...metadata, phase: 'completed' }
});
const assertProductCanBePermanentlyDeleted = (product) => {
  if (product.active !== false || product.status === 'active') {
    throw httpError(409, 'Only inactive products can be permanently deleted.', 'PRODUCT_MUST_BE_ARCHIVED');
  }
  const stockValues = [product.stock, ...(Array.isArray(product.variants) ? product.variants.map((variant) => variant.stock) : [])];
  if (stockValues.some((stock) => !Number.isSafeInteger(stock) || stock !== 0)) {
    throw httpError(409, 'Products with available or invalid stock cannot be permanently deleted.', 'PRODUCT_HAS_STOCK');
  }
};
const parseList = (value, label, max = 30, maxItemLength = 100) => {
  if (value == null || value === '') return [];
  const list = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(list) || list.length > max || list.some((v) => typeof v !== 'string' || !v.trim() || v.length > maxItemLength)) throw httpError(400, `${label} must be a valid list.`);
  return [...new Set(list.map((v) => v.trim()))];
};
const parseMoneyPaise = (value, label, optional = false) => {
  if ((value === undefined || value === null || value === '') && optional) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100000000) throw httpError(400, `${label} must be a non-negative amount.`);
  return catalogUnitsToPaise(number);
};
const parseImages = (value) => {
  const images = parseList(value, 'Images', 30, 2048);
  if (!images.length || images.some((url) => url.length > 2048 || !isValidProductImageUrl(url))) throw httpError(400, 'Provide at least one valid product image URL.');
  return images;
};
const parseProductImages = (value, colours) => {
  const supplied = Array.isArray(value) ? value.length > 0 : String(value || '').trim().length > 0;
  if (supplied) return parseImages(value);
  const primaryGallery = colours.find((colour) => colour.images.length)?.images || [];
  return parseImages(primaryGallery);
};
const parseColours = (value) => {
  if (typeof value === 'string') return value.split(',').map((name) => ({ name: name.trim(), hex: '#D4C5B9' })).filter((x) => x.name);
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 30) throw httpError(400, 'Colours must be a valid list.');
  return value.map((colour) => {
    if (typeof colour === 'string') return { name: colour.trim(), hex: '#D4C5B9' };
    if (!colour || typeof colour.name !== 'string' || !colour.name.trim()) throw httpError(400, 'Each colour needs a name.');
    const images = colour.images === undefined ? [] : parseList(colour.images, `Images for ${colour.name}`, 30, 2048);
    if (images.some((url) => url.length > 2048 || !isValidProductImageUrl(url))) {
      throw httpError(400, `Images for ${colour.name} contain an invalid URL.`);
    }
    return {
      name: colour.name.trim(),
      hex: /^#[0-9a-f]{6}$/i.test(colour.hex || '') ? colour.hex : '#D4C5B9',
      images
    };
  });
};
const ensureVariantIdentifiersAvailable = async (variants, excludeProductId = null) => {
  if (!variants.length) return;
  const exclude = excludeProductId ? { _id: { $ne: excludeProductId } } : {};
  const skus = variants.map(({ sku }) => sku);
  if (await Product.exists({ ...exclude, 'variants.sku': { $in: skus } })) {
    throw httpError(409, 'One or more variant SKUs are already in use.', 'DUPLICATE_VARIANT_SKU');
  }
  const barcodes = variants.map(({ barcode }) => barcode).filter(Boolean);
  if (barcodes.length && await Product.exists({ ...exclude, 'variants.barcode': { $in: barcodes } })) {
    throw httpError(409, 'One or more variant barcodes are already in use.', 'DUPLICATE_VARIANT_BARCODE');
  }
};
const validateVariantPrices = (variants, productPricePaise) => {
  for (const variant of variants) {
    if (variant.discountPricePaise != null && variant.discountPricePaise > (variant.pricePaise ?? productPricePaise)) {
      throw httpError(400, 'Variant sale price cannot exceed its regular price.');
    }
  }
};
const parseMeasurements = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const data = typeof value === 'string' ? JSON.parse(value) : value;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > 20) throw httpError(400, 'Measurements must be a size-to-measurement object.');
  for (const [size, measurements] of Object.entries(data)) {
    if (!size.trim() || !measurements || typeof measurements !== 'object' || Array.isArray(measurements)) throw httpError(400, 'Each size must contain named measurements.');
    for (const amount of Object.values(measurements)) if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw httpError(400, 'Measurements must be non-negative numbers.');
  }
  return data;
};

export const getProducts = asyncHandler(async (req, res) => {
  const query = {};
  if (!isAdmin(req)) {
    query.active = { $ne: false };
    query.gender = { $in: ['men', 'unisex'] };
  }
  const { category, collection, gender, size, colour, minPrice, maxPrice, search, featured, newArrival, bestSeller } = req.query;
  if (category && !['all', 'All'].includes(String(category))) query.category = { $regex: `^${escapeRegex(String(category).slice(0, 100))}$`, $options: 'i' };
  if (collection) query.collectionName = String(collection).slice(0, 100);
  if (isAdmin(req) && gender && gender !== 'all') query.gender = String(gender).toLowerCase();
  if (size) query.sizes = String(size).slice(0, 20);
  if (colour) query['colours.name'] = { $regex: escapeRegex(String(colour).slice(0, 50)), $options: 'i' };
  const minPricePaise = minPrice === undefined ? undefined : parseMoneyPaise(minPrice, 'Minimum price');
  const maxPricePaise = maxPrice === undefined ? undefined : parseMoneyPaise(maxPrice, 'Maximum price');
  if (minPricePaise !== undefined && maxPricePaise !== undefined && minPricePaise > maxPricePaise) throw httpError(400, 'Price range is invalid.');
  const effectivePriceFilter = buildEffectivePriceFilter(minPricePaise, maxPricePaise);
  if (effectivePriceFilter) query.$expr = effectivePriceFilter.$expr;
  if (featured === 'true') query.featured = true;
  if (newArrival === 'true') query.newArrival = true;
  if (bestSeller === 'true') query.bestSeller = true;
  if (search) {
    const term = escapeRegex(String(search).slice(0, 100));
    query.$or = [{ name: { $regex: term, $options: 'i' } }, { description: { $regex: term, $options: 'i' } }, { category: { $regex: term, $options: 'i' } }];
  }
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 24));
  const sortMap = {
    'price-asc': { pricePaise: 1 }, 'Price: Low to High': { pricePaise: 1 },
    'price-desc': { pricePaise: -1 }, 'Price: High to Low': { pricePaise: -1 },
    featured: { featured: -1, createdAt: -1 }, Featured: { featured: -1, createdAt: -1 },
    popular: { bestSeller: -1, createdAt: -1 }, 'Best Sellers': { bestSeller: -1, createdAt: -1 },
    newest: { createdAt: -1 }, Newest: { createdAt: -1 }
  };
  const sort = sortMap[req.query.sort] || sortMap.newest;
  const [products, totalCount] = await Promise.all([
    Product.find(query).sort(sort).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(query)
  ]);
  res.json({ success: true, count: products.length, totalCount, totalPages: Math.ceil(totalCount / limit), currentPage: page, products });
});

export const getProductById = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
  const filter = { _id: req.params.id };
  if (!isAdmin(req)) Object.assign(filter, { active: { $ne: false }, gender: { $in: ['men', 'unisex'] } });
  const product = await Product.findOne(filter);
  if (!product) throw httpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
  const relatedProducts = await Product.find({ category: product.category, active: { $ne: false }, gender: { $in: ['men', 'unisex'] }, _id: { $ne: product._id } }).sort({ createdAt: -1 }).limit(4);
  res.json({ success: true, product, relatedProducts });
});

export const createProduct = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const category = String(body.category || '').trim();
  if (name.length < 2 || !description || !category) throw httpError(400, 'Name, description and category are required.');
  const pricePaise = body.pricePaise !== undefined ? Number(body.pricePaise) : parseMoneyPaise(body.price, 'Price');
  const discountPricePaise = body.discountPricePaise !== undefined ? (body.discountPricePaise == null ? null : Number(body.discountPricePaise)) : parseMoneyPaise(body.discountPrice, 'Sale price', true);
  if (!Number.isSafeInteger(pricePaise) || pricePaise < 0 || (discountPricePaise !== null && (!Number.isSafeInteger(discountPricePaise) || discountPricePaise < 0 || discountPricePaise > pricePaise))) throw httpError(400, 'Price or sale price is invalid.');
  const sizes = parseList(body.sizes, 'Sizes', 20);
  const colours = parseColours(body.colours);
  const variants = body.variants === undefined ? [] : validateVariantMatrix(sizes, colours, body.variants);
  validateVariantPrices(variants, pricePaise);
  await ensureVariantIdentifiersAvailable(variants);
  const stock = body.stock === undefined ? 0 : Number(body.stock);
  if (!Number.isSafeInteger(stock) || stock < 0) throw httpError(400, 'Stock must be a non-negative whole number.');
  const slug = slugify(body.slug || name);
  if (!slug) throw httpError(400, 'Product slug is invalid.');
  const status = body.status === undefined
    ? (body.active === false || body.active === 'false' ? 'archived' : 'active')
    : body.status;
  if (!PRODUCT_STATUSES.has(status)) throw httpError(400, 'Product status is invalid.');
  const hasPrimaryGallery = colours.some((colour) => Array.isArray(colour.images) && colour.images.length > 0);
  const hasSuppliedImages = Array.isArray(body.images)
    ? body.images.length > 0
    : String(body.images || '').trim().length > 0;
  const images = status === 'active' || hasSuppliedImages || hasPrimaryGallery
    ? parseProductImages(body.images, colours)
    : [];
  if (status === 'active') {
    const missing = getProductCompletenessIssues({ name, description, category, pricePaise, images, sizes, colours });
    if (missing.length) throw httpError(400, `Complete these product details before publishing: ${missing.join(', ')}.`, 'PRODUCT_INCOMPLETE');
  }
  await startCatalogAudit(req, 'catalog.product.create', null, null, {
    name, status, pricePaise, imageCount: images.length, variantCount: variants.length
  }, { productName: name });
  const product = await Product.create({
    name, slug, description, shortDescription: body.shortDescription || '', category,
    gender: ['men', 'women', 'unisex'].includes(body.gender) ? body.gender : 'men',
    pricePaise, discountPricePaise, sizes, colours, variants, stock,
    images, featured: body.featured === true || body.featured === 'true',
    newArrival: body.newArrival === true || body.newArrival === 'true', bestSeller: body.bestSeller === true || body.bestSeller === 'true',
    fabricDetails: body.fabricDetails || '', fitDetails: body.fitDetails || '', careInstructions: body.careInstructions || '',
    collectionName: body.collection || body.collectionName || '', measurements: parseMeasurements(body.measurements),
    shippingDetails: body.shippingDetails || '', status, active: status === 'active'
  });
  await logCatalogAudit(req, 'catalog.product.create', product._id, null, auditProductState(product), { productName: product.name });
  res.status(201).json({ success: true, message: 'Product created successfully.', product });
});

export const updateProduct = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Product not found.');
  const product = await Product.findById(req.params.id);
  if (!product) throw httpError(404, 'Product not found.');
  const before = auditProductState(product);
  const body = req.body || {};
  if (body.stock !== undefined) throw httpError(400, 'Stock must be changed through inventory adjustments.');
  const allowed = ['name', 'description', 'shortDescription', 'category', 'gender', 'sizes', 'colours', 'images', 'featured', 'newArrival', 'bestSeller', 'fabricDetails', 'fitDetails', 'careInstructions', 'collection', 'collectionName', 'measurements', 'shippingDetails', 'active'];
  for (const key of allowed) if (body[key] !== undefined) {
    const target = key === 'collection' ? 'collectionName' : key;
    product[target] = ['sizes'].includes(key) ? parseList(body[key], 'Sizes', 20)
      : key === 'colours' ? parseColours(body[key])
      : key === 'images' ? parseImages(body[key])
      : key === 'measurements' ? parseMeasurements(body[key])
      : body[key];
  }
  if (body.status !== undefined) {
    if (!PRODUCT_STATUSES.has(body.status)) throw httpError(400, 'Product status is invalid.');
    product.status = body.status;
    product.active = body.status === 'active';
  }
  if (body.status === 'active' || body.active === true || body.active === 'true') {
    const missing = getProductCompletenessIssues(product);
    if (missing.length) throw httpError(400, `Complete these product details before publishing: ${missing.join(', ')}.`, 'PRODUCT_INCOMPLETE');
  }
  if (body.variants !== undefined) {
    const variants = validateVariantMatrix(product.sizes, product.colours, body.variants);
    if (product.variants.length) {
      assertVariantInventoryUnchanged(product.variants, variants);
    } else if (variants.length && variants.reduce((total, variant) => total + variant.stock, 0) !== product.stock) {
      throw httpError(409, 'Allocate the existing product stock across every SKU before enabling SKU variants.', 'VARIANT_STOCK_MISMATCH');
    }
    const currentByCombination = new Map(product.variants.map((variant) => [
      `${variant.size.toLowerCase()}\u0000${variant.colour.toLowerCase()}`,
      variant
    ]));
    product.variants = variants.map((variant) => {
      const current = currentByCombination.get(`${variant.size.toLowerCase()}\u0000${variant.colour.toLowerCase()}`);
      if (!current) return variant;
      return {
        ...variant,
        reorderTarget: current.reorderTarget ?? null,
        reservedQuantity: current.reservedQuantity ?? 0,
        unitCostPaise: current.unitCostPaise ?? null,
        costedQuantity: current.costedQuantity ?? 0
      };
    });
    await ensureVariantIdentifiersAvailable(product.variants, product._id);
  } else if (product.variants.length && (body.sizes !== undefined || body.colours !== undefined)) {
    throw httpError(400, 'Update the full SKU variant matrix when changing sizes or colours.');
  }
  if (body.price !== undefined) product.pricePaise = parseMoneyPaise(body.price, 'Price');
  if (body.pricePaise !== undefined) {
    const value = Number(body.pricePaise);
    if (!Number.isSafeInteger(value) || value < 0) throw httpError(400, 'Price in paise must be a non-negative integer.');
    product.pricePaise = value;
  }
  if (body.discountPrice !== undefined) product.discountPricePaise = parseMoneyPaise(body.discountPrice, 'Sale price', true);
  if (body.discountPricePaise !== undefined) {
    const value = body.discountPricePaise == null ? null : Number(body.discountPricePaise);
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw httpError(400, 'Sale price in paise must be a non-negative integer.');
    product.discountPricePaise = value;
  }
  if (product.discountPricePaise != null && product.discountPricePaise > product.pricePaise) throw httpError(400, 'Sale price cannot exceed regular price.');
  validateVariantPrices(product.variants, product.pricePaise);
  await startCatalogAudit(req, 'catalog.product.update', product._id, before, auditProductState(product), { productName: product.name });
  await product.save();
  await logCatalogAudit(req, 'catalog.product.update', product._id, before, auditProductState(product), { productName: product.name });
  res.json({ success: true, message: 'Product updated successfully.', product });
});

export const archiveProduct = asyncHandler(async (req, res) => {
  const existing = await Product.findById(req.params.id);
  if (!existing) throw httpError(404, 'Product not found.');
  const before = auditProductState(existing);
  await startCatalogAudit(req, 'catalog.product.archive', existing._id, before, { ...before, active: false, status: 'archived' }, { productName: existing.name });
  const product = await Product.findByIdAndUpdate(req.params.id, { $set: { active: false, status: 'archived' } }, { new: true });
  if (!product) throw httpError(404, 'Product not found.');
  await logCatalogAudit(req, 'catalog.product.archive', product._id, before, auditProductState(product), { productName: product.name });
  res.json({ success: true, message: 'Product archived successfully.', product });
});

export const permanentlyDeleteProduct = asyncHandler(async (req, res) => {
  const existingProduct = await Product.findById(req.params.id);
  if (!existingProduct) throw httpError(404, 'Product not found.');
  assertProductCanBePermanentlyDeleted(existingProduct);
  if (!supportsMongoTransactions()) {
    throw httpError(503, 'Permanent deletion requires a MongoDB replica set or sharded cluster.', 'TRANSACTIONS_REQUIRED');
  }

  const session = await mongoose.startSession();
  let deletedProduct;
  try {
    await session.withTransaction(async () => {
      const product = await Product.findById(req.params.id).session(session);
      if (!product) throw httpError(404, 'Product not found.');
      assertProductCanBePermanentlyDeleted(product);

      const hasReferences = await Promise.all([
        Order.exists({ 'items.product': product._id }).session(session),
        StockMovement.exists({ 'changes.product': product._id }).session(session),
        Cart.exists({ 'items.product': product._id }).session(session),
        Wishlist.exists({ products: product._id }).session(session)
      ]);
      if (hasReferences.some(Boolean)) {
        throw httpError(409, 'Products with order, inventory, cart, or wishlist history cannot be permanently deleted.', 'PRODUCT_HAS_HISTORY');
      }

      const result = await Product.deleteOne({ _id: product._id, active: false, stock: { $lte: 0 } }, { session });
      if (result.deletedCount !== 1) throw httpError(409, 'Product changed before deletion; refresh and try again.', 'PRODUCT_CHANGED');

      await ProductDeletionAudit.create([{
        productId: product._id,
        productName: product.name,
        productSlug: product.slug,
        performedBy: req.user._id
      }], { session });
      await AdminAudit.create([{
        actor: req.user._id,
        action: 'catalog.product.delete_permanent',
        target: null,
        reason: 'Admin catalog operation: catalog.product.delete_permanent',
        before: auditProductState(product),
        after: null,
        metadata: { targetId: String(product._id), productName: product.name }
      }], { session });
      deletedProduct = { _id: product._id, name: product.name };
    });
  } finally {
    await session.endSession();
  }

  res.json({ success: true, message: 'Product permanently deleted.', product: deletedProduct });
});

export const getCategories = asyncHandler(async (req, res) => {
  const filter = isAdmin(req) ? {} : { active: true };
  const categories = await Category.find(filter).sort({ name: 1 }).lean();
  const counts = await Product.aggregate([
    { $match: { active: { $ne: false }, gender: { $in: ['men', 'unisex'] } } },
    { $group: { _id: { $toLower: '$category' }, count: { $sum: 1 } } }
  ]);
  const countMap = new Map(counts.map((row) => [row._id, row.count]));
  res.json({ success: true, categories: categories.map((category) => ({ ...category, itemCount: countMap.get(category.name.toLowerCase()) || 0 })) });
});

export const createCategory = asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 2 || name.length > 100) throw httpError(400, 'Category name must be between 2 and 100 characters.');
  await startCatalogAudit(req, 'catalog.category.create', null, null, { name, slug: slugify(name), active: true });
  const category = await Category.create({ name, slug: slugify(name), description: req.body.description || '', image: req.body.image || '', gender: req.body.gender || 'all' });
  await logCatalogAudit(req, 'catalog.category.create', category._id, null, { name: category.name, slug: category.slug, active: category.active });
  res.status(201).json({ success: true, message: 'Category created successfully.', category });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw httpError(404, 'Category not found.');
  const before = { name: category.name, slug: category.slug, description: category.description, image: category.image, gender: category.gender, active: category.active };
  if (req.body.name && req.body.name !== category.name) {
    if (requiredCategorySlugs.has(category.slug)) throw httpError(409, 'The four storefront category names are fixed.');
    throw httpError(503, 'Category renaming is unavailable until product and category updates can run transactionally.', 'TRANSACTIONS_REQUIRED');
  }
  for (const key of ['description', 'image', 'gender']) if (req.body[key] !== undefined) category[key] = req.body[key];
  await startCatalogAudit(req, 'catalog.category.update', category._id, before, { name: category.name, slug: category.slug, description: category.description, image: category.image, gender: category.gender, active: category.active });
  await category.save();
  await logCatalogAudit(req, 'catalog.category.update', category._id, before, { name: category.name, slug: category.slug, description: category.description, image: category.image, gender: category.gender, active: category.active });
  res.json({ success: true, message: 'Category updated successfully.', category });
});

export const archiveCategory = asyncHandler(async (req, res) => {
  const existing = await Category.findById(req.params.id);
  if (!existing) throw httpError(404, 'Category not found.');
  if (requiredCategorySlugs.has(existing.slug)) throw httpError(409, 'The four storefront categories cannot be deleted.');
  await startCatalogAudit(req, 'catalog.category.archive', existing._id, { name: existing.name, slug: existing.slug, active: existing.active }, { name: existing.name, slug: existing.slug, active: false });
  const category = await Category.findByIdAndUpdate(req.params.id, { $set: { active: false } }, { new: true });
  if (!category) throw httpError(404, 'Category not found.');
  await logCatalogAudit(req, 'catalog.category.archive', category._id, { name: existing.name, slug: existing.slug, active: existing.active }, { name: category.name, slug: category.slug, active: category.active });
  res.json({ success: true, message: 'Category archived successfully.', category });
});

export const getCollections = asyncHandler(async (req, res) => {
  const records = await Collection.find(isAdmin(req) ? {} : { active: true }).sort({ name: 1 }).select('name description active');
  res.json({ success: true, collections: records.map((record) => record.name), collectionRecords: records });
});

export const createCollection = asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  if (!name || name.length > 100 || description.length > 500) throw httpError(400, 'Collection name and description are invalid.');
  await startCatalogAudit(req, 'catalog.collection.create', null, null, { name, slug: slugify(name), active: true });
  const collection = await Collection.create({ name, slug: slugify(name), description });
  await logCatalogAudit(req, 'catalog.collection.create', collection._id, null, { name: collection.name, slug: collection.slug, active: collection.active });
  res.status(201).json({ success: true, collection });
});

export const renameCollection = asyncHandler(async () => {
  throw httpError(503, 'Collection renaming is unavailable until product and collection updates can run transactionally.', 'TRANSACTIONS_REQUIRED');
});

export const removeCollection = asyncHandler(async () => {
  throw httpError(503, 'Collection removal is unavailable until product unlinking and collection deletion can run transactionally.', 'TRANSACTIONS_REQUIRED');
});
