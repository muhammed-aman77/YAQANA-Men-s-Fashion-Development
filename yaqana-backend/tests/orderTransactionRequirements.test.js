import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import StockMovement from '../src/models/StockMovement.js';
import User from '../src/models/User.js';
import { createOrder, updateOrderStatus } from '../src/controllers/orderController.js';

const localDatabaseUri = 'mongodb://127.0.0.1:27017/yaqana_local_dev_20261115';

test('checkout and cancellation report their replica-set transaction requirement', {
  skip: process.env.RUN_LOCAL_DB_TESTS !== '1'
}, async (t) => {
  await mongoose.connect(localDatabaseUri, { serverSelectionTimeoutMS: 3000 });
  const suffix = randomUUID().replace(/-/g, '');
  const checkoutKey = `checkout-test-${suffix}`;
  const cancelKey = `cancel-test-${suffix}`;
  let product;
  let order;
  t.after(async () => {
    if (order) await Order.deleteOne({ _id: order._id });
    await Order.deleteMany({ idempotencyKey: { $in: [checkoutKey, cancelKey] } });
    await StockMovement.deleteMany({ referenceId: order?._id });
    if (product) await Product.deleteOne({ _id: product._id });
    await mongoose.disconnect();
  });

  const admin = await User.findOne({ role: 'admin', status: 'active' }).select('_id');
  assert.ok(admin, 'the confirmed local database must contain an active admin');
  product = await Product.create({
    name: `Order Transaction ${suffix}`,
    slug: `order-transaction-${suffix}`,
    description: 'Temporary local order integration fixture.',
    category: 'Test',
    pricePaise: 10000,
    stock: 10,
    active: true
  });

  const invoke = async (handler, req) => {
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    let forwardedError;
    await handler(req, response, (error) => { forwardedError = error; });
    return { response, error: forwardedError };
  };
  const address = {
    fullName: 'Local Test Admin',
    phone: '9876543210',
    addressLine1: '12 Test Road',
    city: 'Kolkata',
    state: 'West Bengal',
    postalCode: '700001',
    country: 'India'
  };

  const checkout = await invoke(createOrder, {
    user: admin,
    get: (name) => name === 'Idempotency-Key' ? checkoutKey : undefined,
    body: {
      items: [{ product: String(product._id), quantity: 1, size: 'N/A', colour: 'Default' }],
      shippingAddress: address,
      paymentMethod: 'Cash on Delivery'
    }
  });
  assert.equal(checkout.error?.statusCode, 503);
  assert.equal(await Product.findById(product._id).then((entry) => entry.stock), 10);
  assert.equal(await Order.countDocuments({ idempotencyKey: checkoutKey }), 0);

  order = await Order.create({
    customer: admin._id,
    idempotencyKey: cancelKey,
    items: [{ product: product._id, name: product.name, pricePaise: 10000, quantity: 1, size: 'N/A', colour: 'Default' }],
    shippingAddress: address,
    paymentMethod: 'Cash on Delivery',
    paymentStatus: 'Pending',
    orderStatus: 'Confirmed',
    subtotalPaise: 10000,
    shippingFeePaise: 0,
    taxPaise: 0,
    totalPaise: 10000
  });
  const cancellation = await invoke(updateOrderStatus, {
    user: admin,
    params: { id: String(order._id) },
    body: { orderStatus: 'Cancelled' }
  });
  assert.equal(cancellation.error?.statusCode, 503);
  assert.equal(await Order.findById(order._id).then((entry) => entry.orderStatus), 'Confirmed');
  assert.equal(await Product.findById(product._id).then((entry) => entry.stock), 10);
  assert.equal(await StockMovement.countDocuments({ referenceId: order._id, type: 'order_cancel' }), 0);
});
