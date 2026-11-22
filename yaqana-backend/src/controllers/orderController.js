import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Cart from '../models/Cart.js';
import StockMovement from '../models/StockMovement.js';
import AdminAudit from '../models/AdminAudit.js';
import { asyncHandler, httpError } from '../utils/http.js';
import { env } from '../config/env.js';
import { PAISE_PER_CATALOG_UNIT, paiseToCatalogUnits } from '../utils/money.js';
import {
  canTransitionOrderStatus,
  getAllowedOrderTransitions,
  isKnownOrderStatus
} from '../utils/orderStatus.js';
import { buildStockMovementChange, buildVariantStockAdjustment } from '../utils/variantInventory.js';
import { findProductVariant } from '../utils/productVariants.js';
import { supportsMongoTransactions } from '../utils/mongoTransactions.js';
import { assertCheckoutQuoteMatches, buildCheckoutQuote, getCheckoutProductIds } from '../utils/checkoutQuote.js';
import { signCheckoutQuote, verifyCheckoutQuote } from '../utils/checkoutQuoteToken.js';

const allowedPaymentMethods = new Set(['Cash on Delivery', 'Google Pay (UPI)', 'PhonePe (UPI)', 'Paytm (UPI)', 'UPI']);
const checkoutPricing = {
  paisePerCatalogUnit: PAISE_PER_CATALOG_UNIT,
  shippingThreshold: env.LEGACY_SHIPPING_THRESHOLD,
  shippingFee: env.LEGACY_SHIPPING_FEE,
  taxRate: env.LEGACY_TAX_RATE
};

function toPublicQuote(quote) {
  return {
    lines: quote.lines.map((line) => ({
      productId: line.productId,
      sku: line.sku,
      name: line.name,
      image: line.image,
      category: line.category,
      price: paiseToCatalogUnits(line.pricePaise),
      originalPrice: paiseToCatalogUnits(line.originalPricePaise),
      quantity: line.quantity,
      size: line.size,
      colour: line.colour,
      availableStock: line.availableStock
    })),
    originalSubtotal: paiseToCatalogUnits(quote.originalSubtotalPaise),
    discount: paiseToCatalogUnits(quote.discountPaise),
    subtotal: paiseToCatalogUnits(quote.subtotalPaise),
    shippingFee: paiseToCatalogUnits(quote.shippingFeePaise),
    tax: paiseToCatalogUnits(quote.taxPaise),
    total: paiseToCatalogUnits(quote.totalPaise)
  };
}

const requestFingerprint = (body) => createHash('sha256').update(JSON.stringify({
  items: (body.items || []).map((item) => ({ product: String(item.product || item.productId), sku: String(item.sku || ''), quantity: item.quantity, size: item.size || 'N/A', colour: item.colour || 'Default' })).sort((a, b) => a.product.localeCompare(b.product) || a.size.localeCompare(b.size) || a.colour.localeCompare(b.colour)),
  shippingAddress: body.shippingAddress, paymentMethod: body.paymentMethod, notes: body.notes || ''
})).digest('hex');

function validateAddress(address) {
  if (!address || !address.fullName || !address.addressLine1 || !address.city || !address.state) throw httpError(400, 'Please provide full shipping details.');
  if (!/^\d{6}$/.test(String(address.postalCode || ''))) throw httpError(400, 'Enter a valid 6-digit PIN code.');
  if (!/^\d{10}$/.test(String(address.phone || '').replace(/\D/g, ''))) throw httpError(400, 'Enter a valid 10-digit phone number.');
  if (address.email !== undefined) {
    address.email = String(address.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) throw httpError(400, 'Enter a valid delivery email address.');
  }
}

export const quoteOrder = asyncHandler(async (req, res) => {
  const items = req.body?.items;
  const productIds = getCheckoutProductIds(items);
  const products = await Product.find({
    _id: { $in: productIds },
    active: { $ne: false },
    gender: { $in: ['men', 'unisex'] }
  }).lean();
  const quote = buildCheckoutQuote(items, products, checkoutPricing);
  const quoteToken = signCheckoutQuote(quote, req.user._id, env.JWT_SECRET);
  res.json({ success: true, quote: toPublicQuote(quote), quoteToken });
});

export const createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, paymentMethod = 'Google Pay (UPI)', notes = '' } = req.body || {};
  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) throw httpError(400, 'A valid checkout request key is required. Please retry checkout.');
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw httpError(400, 'Your bag is empty or contains too many items.');
  if (!allowedPaymentMethods.has(paymentMethod)) throw httpError(400, 'Please select a supported payment method.');
  const productIds = getCheckoutProductIds(items);
  validateAddress(shippingAddress);
  const requestHash = requestFingerprint(req.body);
  const existing = await Order.findOne({ customer: req.user._id, idempotencyKey }).select('+requestHash');
  if (existing) {
    if (existing.requestHash !== requestHash) throw httpError(409, 'This checkout key was already used for a different order. Please refresh checkout.', 'IDEMPOTENCY_KEY_REUSED');
    return res.json({ success: true, message: 'This checkout was already completed.', order: existing });
  }
  if (!supportsMongoTransactions()) {
    throw httpError(503, 'Order checkout requires MongoDB replica-set or sharded transactions to keep stock, order, and cart changes consistent.', 'TRANSACTIONS_REQUIRED');
  }
  const signedQuote = verifyCheckoutQuote(req.body?.quoteToken, String(req.user._id), env.JWT_SECRET);

  const session = await mongoose.startSession();
  let order;
  try {
    await session.withTransaction(async () => {
      const currentProducts = await Product.find({
        _id: { $in: productIds },
        active: { $ne: false },
        gender: { $in: ['men', 'unisex'] }
      }).session(session).lean();
      const currentQuote = buildCheckoutQuote(items, currentProducts, checkoutPricing);
      assertCheckoutQuoteMatches(signedQuote, currentQuote);

      const orderItems = [];
      const stockChanges = [];
      for (const item of items) {
        const productId = item?.product || item?.productId;
        const quantity = Number(item?.quantity);
        const product = await Product.findOne({ _id: productId, active: { $ne: false }, gender: { $in: ['men', 'unisex'] } }).session(session);
        if (!product) throw httpError(404, 'One of the selected products is no longer available.');
        const size = String(item.size || 'N/A');
        const colour = String(item.colour || 'Default');
        if (product.sizes.length && !product.sizes.includes(size)) throw httpError(400, `Please select a valid size for ${product.name}.`);
        if (product.colours.length && !product.colours.some((entry) => entry.name.toLowerCase() === colour.toLowerCase())) throw httpError(400, `Please select a valid colour for ${product.name}.`);
        const variant = findProductVariant(product, size, colour);
        if (product.variants.length && !variant) throw httpError(409, `The selected size and colour for ${product.name} are unavailable.`);
        const stockAdjustment = variant ? buildVariantStockAdjustment(variant.sku, quantity, 'decrease') : null;
        const stockFilter = variant
          ? { _id: product._id, stock: { $gte: quantity }, active: { $ne: false }, variants: { $elemMatch: stockAdjustment.filter } }
          : { _id: product._id, stock: { $gte: quantity }, active: { $ne: false } };
        const stockUpdate = stockAdjustment?.update || { $inc: { stock: -quantity } };
        const updated = await Product.findOneAndUpdate(stockFilter, stockUpdate, { new: true, session });
        if (!updated) throw httpError(409, `Insufficient stock for ${product.name}.`);
        stockChanges.push(buildStockMovementChange(product, variant, -quantity));
        const colourGallery = product.colours.find((entry) => entry.name.toLowerCase() === colour.toLowerCase())?.images || [];
        const quoteLine = currentQuote.lines[orderItems.length];
        orderItems.push({
          product: product._id,
          sku: variant?.sku,
          name: product.name,
          image: colourGallery[0] || product.images[0] || '',
          category: product.category,
          pricePaise: quoteLine.pricePaise,
          originalPricePaise: quoteLine.originalPricePaise,
          quantity,
          size,
          colour
        });
      }
      [order] = await Order.create([{
        customer: req.user._id, idempotencyKey, requestHash, items: orderItems, shippingAddress,
        paymentMethod, paymentStatus: 'Pending', orderStatus: 'Confirmed',
        subtotalPaise: currentQuote.subtotalPaise,
        discountPaise: currentQuote.discountPaise,
        shippingFeePaise: currentQuote.shippingFeePaise,
        taxPaise: currentQuote.taxPaise,
        totalPaise: currentQuote.totalPaise,
        notes: String(notes).slice(0, 1000),
        statusHistory: [{ status: 'Confirmed', changedBy: req.user._id, reason: 'Order placed through storefront' }]
      }], { session });
      await StockMovement.create([{
        changes: stockChanges,
        reason: 'Order placed through storefront',
        type: 'order',
        referenceId: order._id,
        performedBy: req.user._id
      }], { session });
      await Cart.findOneAndUpdate({ user: req.user._id }, { $set: { items: [] } }, { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await Order.findOne({ customer: req.user._id, idempotencyKey }).select('+requestHash');
      if (prior && prior.requestHash === requestHash) return res.json({ success: true, message: 'This checkout was already completed.', order: prior });
      if (prior) throw httpError(409, 'This checkout key was already used for a different order.', 'IDEMPOTENCY_KEY_REUSED');
    }
    throw error;
  } finally {
    await session.endSession();
  }
  res.status(201).json({ success: true, message: 'Order placed successfully. Payment has not been processed in this test checkout.', order });
});

export const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ customer: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, orders });
});

export const getOrderById = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Order not found.');
  const order = await Order.findById(req.params.id).populate('customer', 'name email phone');
  if (!order) throw httpError(404, 'Order not found.');
  const ownerId = order.customer?._id || order.customer;
  if (String(ownerId) !== String(req.user._id) && !['admin', 'owner'].includes(req.user.role)) throw httpError(403, 'You are not allowed to view this order.');
  res.json({ success: true, order });
});

export const getAllOrders = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const query = {};
  const status = String(req.query.status || '').trim();
  if (status && status !== 'all') {
    if (!isKnownOrderStatus(status)) throw httpError(400, 'Unsupported order status filter.');
    query.orderStatus = status;
  }

  const paymentStatus = String(req.query.paymentStatus || '').trim();
  const paymentStatuses = Order.schema.path('paymentStatus').enumValues;
  if (paymentStatus && paymentStatus !== 'all') {
    if (!paymentStatuses.includes(paymentStatus)) throw httpError(400, 'Unsupported payment status filter.');
    query.paymentStatus = paymentStatus;
  }

  const paymentType = String(req.query.paymentType || '').trim().toLowerCase();
  if (paymentType && paymentType !== 'all') {
    if (!['cod', 'prepaid'].includes(paymentType)) throw httpError(400, 'Unsupported payment type filter.');
    query.paymentMethod = paymentType === 'cod'
      ? 'Cash on Delivery'
      : { $ne: 'Cash on Delivery' };
  }

  const parseDateBoundary = (value, endOfDay) => {
    if (!value) return null;
    const dateString = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) throw httpError(400, 'Order date filters must use YYYY-MM-DD.');
    const date = new Date(`${dateString}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateString) {
      throw httpError(400, 'Order date filter is not a valid calendar date.');
    }
    return date;
  };
  const dateFrom = parseDateBoundary(req.query.dateFrom, false);
  const dateTo = parseDateBoundary(req.query.dateTo, true);
  if (dateFrom && dateTo && dateFrom > dateTo) throw httpError(400, 'Order start date must not be after the end date.');
  if (dateFrom || dateTo) {
    query.createdAt = {
      ...(dateFrom ? { $gte: dateFrom } : {}),
      ...(dateTo ? { $lte: dateTo } : {})
    };
  }

  const search = String(req.query.search || '').trim().slice(0, 100);
  if (search) {
    const term = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const User = (await import('../models/User.js')).default;
    const customers = await User.find({
      $or: [
        { name: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
        { phone: { $regex: term, $options: 'i' } }
      ]
    }).select('_id');
    const orderIdFilter = mongoose.isValidObjectId(search)
      ? { _id: search }
      : {
          $expr: {
            $regexMatch: {
              input: { $substrBytes: [{ $toString: '$_id' }, 16, 8] },
              regex: term,
              options: 'i'
            }
          }
        };
    query.$or = [orderIdFilter, { customer: { $in: customers.map((user) => user._id) } }];
  }
  const [orders, totalOrders] = await Promise.all([
    Order.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('customer', 'name email phone'),
    Order.countDocuments(query)
  ]);
  res.json({
    success: true,
    orders: orders.map((order) => ({
      ...order.toJSON(),
      allowedNextStatuses: getAllowedOrderTransitions(order.orderStatus)
    })),
    totalOrders,
    currentPage: page,
    totalPages: Math.ceil(totalOrders / limit)
  });
});

export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { orderStatus, notes } = req.body || {};
  if (!isKnownOrderStatus(orderStatus)) throw httpError(400, 'Invalid order status.');
  if (!supportsMongoTransactions()) {
    throw httpError(503, 'Order status changes and stock restoration require MongoDB replica-set or sharded transactions.', 'TRANSACTIONS_REQUIRED');
  }
  const session = await mongoose.startSession();
  let order;
  try {
    await session.withTransaction(async () => {
      order = await Order.findById(req.params.id).session(session);
      if (!order) throw httpError(404, 'Order not found.');
      if (!canTransitionOrderStatus(order.orderStatus, orderStatus)) throw httpError(409, `Order cannot move from ${order.orderStatus} to ${orderStatus}.`);
      const previousStatus = order.orderStatus;
      if (orderStatus === 'Cancelled' && ['Confirmed', 'Pending', 'Processing'].includes(order.orderStatus)) {
        const stockChanges = [];
        for (const item of order.items) {
          const product = await Product.findById(item.product).session(session);
          if (!product) throw httpError(409, 'Could not restore inventory because a product is missing.');
          if (item.sku) {
            const variant = product.variants.find((entry) => entry.sku === item.sku);
            if (!variant) throw httpError(409, `Could not restore inventory for SKU ${item.sku}.`);
            const adjustment = buildVariantStockAdjustment(item.sku, item.quantity, 'increase');
            const result = await Product.updateOne({ _id: item.product, variants: { $elemMatch: adjustment.filter } }, adjustment.update, { session });
            if (!result.matchedCount) throw httpError(409, `Could not restore inventory for SKU ${item.sku}.`);
            stockChanges.push(buildStockMovementChange(product, variant, item.quantity));
          } else {
            const result = await Product.updateOne(
              { _id: item.product, stock: { $lte: Number.MAX_SAFE_INTEGER - item.quantity } },
              { $inc: { stock: item.quantity } },
              { session }
            );
            if (!result.matchedCount) throw httpError(409, `Could not restore inventory for ${product.name}.`);
            stockChanges.push(buildStockMovementChange(product, null, item.quantity));
          }
        }
        await StockMovement.create([{
          changes: stockChanges,
          reason: 'Order cancelled; stock returned to available inventory',
          type: 'order_cancel',
          referenceId: order._id,
          performedBy: req.user._id
        }], { session });
      }
      if (orderStatus !== order.orderStatus) {
        order.orderStatus = orderStatus;
        order.statusHistory.push({ status: orderStatus, changedBy: req.user._id, reason: String(notes || '').slice(0, 300) });
      }
      if (notes !== undefined) order.notes = String(notes).slice(0, 1000);
      await order.save({ session });
      await AdminAudit.create([{
        actor: req.user._id,
        action: 'order.status.update',
        reason: `Order status changed from ${previousStatus} to ${orderStatus}`,
        before: { orderStatus: previousStatus },
        after: { orderStatus: order.orderStatus },
        metadata: { targetId: String(order._id) }
      }], { session });
    });
  } finally { await session.endSession(); }
  res.json({ success: true, message: 'Order updated successfully.', order });
});

export const updateCodLifecycle = asyncHandler(async () => {
  // COD collection and settlement rules remain deferred until approved business policy exists.
  throw httpError(501, 'COD lifecycle updates are not available yet.', 'COD_LIFECYCLE_DEFERRED');
});

export const updateOrderShipment = asyncHandler(async () => {
  // Carrier and shipment workflows remain deferred until their business rules are approved.
  throw httpError(501, 'Shipment updates are not available yet.', 'SHIPMENT_WORKFLOW_DEFERRED');
});

export const createReturnOrRefund = asyncHandler(async () => {
  // Business eligibility, refund validation, staff review, and audit rules are not approved.
  // Stop before reading an idempotency key or touching MongoDB so transaction support cannot
  // accidentally activate this deferred workflow.
  throw httpError(501, 'Returns and refunds are not available yet. Please contact customer care.', 'RETURN_REFUND_DEFERRED');
});
