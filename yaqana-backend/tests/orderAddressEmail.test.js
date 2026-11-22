import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Order from '../src/models/Order.js';

function createOrder(email) {
  const shippingAddress = {
    fullName: 'Local Test Customer',
    phone: '9876543210',
    addressLine1: '12 Test Road',
    city: 'Kolkata',
    state: 'West Bengal',
    postalCode: '700001',
    country: 'India'
  };
  if (email !== undefined) shippingAddress.email = email;

  return new Order({
    customer: new mongoose.Types.ObjectId(),
    items: [{
      product: new mongoose.Types.ObjectId(),
      name: 'YAQANA Mock Tee',
      pricePaise: 8300,
      quantity: 1,
      size: 'M',
      colour: 'Sand'
    }],
    shippingAddress,
    paymentMethod: 'Cash on Delivery',
    subtotalPaise: 8300,
    shippingFeePaise: 0,
    taxPaise: 0,
    totalPaise: 8300
  });
}

test('order shipping address stores an optional contact email', async () => {
  const order = createOrder('  Customer@Example.com ');

  await order.validate();

  assert.equal(order.shippingAddress.email, 'customer@example.com');
});

test('legacy order addresses without email remain valid', async () => {
  const order = createOrder();

  await assert.doesNotReject(() => order.validate());
  assert.equal(order.shippingAddress.email, undefined);
});

test('order persists the verified discount breakdown', async () => {
  const order = createOrder();
  order.items[0].originalPricePaise = 16600;
  order.discountPaise = 8300;

  await order.validate();

  assert.equal(order.items[0].originalPricePaise, 16600);
  assert.equal(order.toJSON().items[0].originalPrice, 2);
  assert.equal(order.discountPaise, 8300);
  assert.equal(order.toJSON().discount, 1);
});

test('legacy order lines without original prices remain valid', async () => {
  const order = createOrder();

  await assert.doesNotReject(() => order.validate());
  assert.equal(order.items[0].originalPricePaise, undefined);
});
