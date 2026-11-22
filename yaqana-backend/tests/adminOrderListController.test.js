import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { getAllOrders } from '../src/controllers/orderController.js';
import { getCustomerDetails, getCustomers } from '../src/controllers/adminController.js';
import Order from '../src/models/Order.js';
import Address from '../src/models/Address.js';
import User from '../src/models/User.js';

test('GET /api/orders combines search, filters, and bounded pagination', async (t) => {
  const customerId = '507f1f77bcf86cd799439011';
  const orderId = '507f191e810c19729de860ea';
  const orderRecord = {
    orderStatus: 'Processing',
    toJSON: () => ({ _id: orderId, orderStatus: 'Processing' })
  };
  let customerQuery;
  let orderQuery;
  let countQuery;
  let skipValue;
  let limitValue;

  t.mock.method(User, 'find', (query) => {
    customerQuery = query;
    return { select: async () => [{ _id: customerId }] };
  });
  t.mock.method(Order, 'find', (query) => {
    orderQuery = query;
    const chain = {
      sort: () => chain,
      skip: (value) => { skipValue = value; return chain; },
      limit: (value) => { limitValue = value; return chain; },
      populate: () => chain,
      then: (resolve, reject) => Promise.resolve([orderRecord]).then(resolve, reject)
    };
    return chain;
  });
  t.mock.method(Order, 'countDocuments', async (query) => {
    countQuery = query;
    return 125;
  });

  const app = express();
  app.get('/api/orders', getAllOrders);
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const { port } = server.address();
  const response = await fetch(
    `http://127.0.0.1:${port}/api/orders?search=ABCDEF12&status=Processing&paymentStatus=Pending&paymentType=cod&dateFrom=2026-11-01&dateTo=2026-11-20&page=2&limit=1000`
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(customerQuery.$or.map((condition) => Object.keys(condition)[0]), ['name', 'email', 'phone']);
  assert.equal(customerQuery.$or[2].phone.$regex, 'ABCDEF12');
  assert.equal(orderQuery.orderStatus, 'Processing');
  assert.equal(orderQuery.paymentStatus, 'Pending');
  assert.equal(orderQuery.paymentMethod, 'Cash on Delivery');
  assert.equal(orderQuery.createdAt.$gte.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(orderQuery.createdAt.$lte.toISOString(), '2026-11-20T23:59:59.999Z');
  assert.deepEqual(orderQuery.$or[0].$expr.$regexMatch.input.$substrBytes, [{ $toString: '$_id' }, 16, 8]);
  assert.equal(orderQuery.$or[0].$expr.$regexMatch.regex, 'ABCDEF12');
  assert.deepEqual(orderQuery.$or[1].customer.$in, [customerId]);
  assert.deepEqual(countQuery, orderQuery);
  assert.equal(skipValue, 100);
  assert.equal(limitValue, 100);
  assert.deepEqual(body, {
    success: true,
    orders: [{ _id: orderId, orderStatus: 'Processing', allowedNextStatuses: ['Shipped', 'Cancelled'] }],
    totalOrders: 125,
    currentPage: 2,
    totalPages: 2
  });
});

test('GET /api/orders rejects unsupported filter values and invalid date ranges', async (t) => {
  t.mock.method(Order, 'find', () => {
    const chain = {
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      populate: async () => []
    };
    return chain;
  });
  t.mock.method(Order, 'countDocuments', async () => 0);

  const invalidQueries = [
    { status: 'Unknown' },
    { paymentStatus: 'Unpaid' },
    { paymentType: 'cash' },
    { dateFrom: '2026-02-30' },
    { dateFrom: '2026-11-20', dateTo: '2026-11-01' }
  ];

  for (const query of invalidQueries) {
    let forwardedError;
    await getAllOrders({ query }, {
      status() { return this; },
      json() { return this; }
    }, (error) => { forwardedError = error; });
    assert.equal(forwardedError?.statusCode, 400, JSON.stringify(query));
  }
});

test('GET /api/admin/customers scopes results to customers and returns bounded search pagination', async (t) => {
  const customerId = '507f1f77bcf86cd799439011';
  const customerRecord = {
    _id: customerId,
    name: 'Alex Customer',
    email: 'alex@example.test',
    phone: '+919876543210',
    status: 'active',
    createdAt: new Date('2026-11-15T10:30:00.000Z')
  };
  let userQuery;
  let selectedFields;
  let skipValue;
  let limitValue;
  let countQuery;
  let aggregatePipeline;

  t.mock.method(User, 'find', (query) => {
    userQuery = query;
    const chain = {
      sort: () => chain,
      skip: (value) => { skipValue = value; return chain; },
      limit: (value) => { limitValue = value; return chain; },
      select: async (fields) => { selectedFields = fields; return [customerRecord]; }
    };
    return chain;
  });
  t.mock.method(User, 'countDocuments', async (query) => {
    countQuery = query;
    return 125;
  });
  t.mock.method(Order, 'aggregate', async (pipeline) => {
    aggregatePipeline = pipeline;
    return [{ _id: customerId, orderCount: 2, totalSpentPaise: 240_700 }];
  });

  const app = express();
  app.get('/api/admin/customers', getCustomers);
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/customers?search=alex%40example.test&status=active&page=2&limit=1000`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(userQuery.role, 'customer');
  assert.equal(userQuery.status, 'active');
  assert.ok(userQuery.$or[1].email instanceof RegExp);
  assert.equal(userQuery.$or[1].email.source, 'alex@example\\.test');
  assert.equal(userQuery.$or[1].email.flags, 'i');
  assert.deepEqual(countQuery, userQuery);
  assert.equal(skipValue, 100);
  assert.equal(limitValue, 100);
  assert.equal(selectedFields, 'name email phone status createdAt');
  assert.deepEqual(aggregatePipeline[0].$match.customer.$in, [customerId]);
  assert.deepEqual(body, {
    success: true,
    customers: [{
      _id: customerId,
      name: 'Alex Customer',
      email: 'alex@example.test',
      phone: '+919876543210',
      status: 'active',
      createdAt: '2026-11-15T10:30:00.000Z',
      orderCount: 2,
      totalSpent: 29
    }],
    totalCustomers: 125,
    currentPage: 2,
    totalPages: 2
  });
});

test('GET /api/admin/customers/:id returns only that customer and a bounded order history', async (t) => {
  const customerId = '507f1f77bcf86cd799439011';
  const addressRecord = { city: 'Kolkata', postalCode: '700001', isDefault: true };
  const orderRecord = { _id: '507f191e810c19729de860ea', orderStatus: 'Delivered', totalPaise: 240_700 };
  let customerQuery;
  let addressQuery;
  let orderQuery;
  let orderProjection;
  let orderLimit;

  t.mock.method(User, 'findOne', (query) => {
    customerQuery = query;
    const chain = {
      select: () => chain,
      lean: async () => ({ _id: customerId, name: 'Alex Customer', email: 'alex@example.test', phone: '+919876543210', status: 'active', createdAt: new Date('2026-11-15T10:30:00.000Z') })
    };
    return chain;
  });
  t.mock.method(Address, 'find', (query) => {
    addressQuery = query;
    const chain = { sort: () => chain, lean: async () => [addressRecord] };
    return chain;
  });
  t.mock.method(Order, 'find', (query) => {
    orderQuery = query;
    const chain = {
      sort: () => chain,
      limit: (value) => { orderLimit = value; return chain; },
      select: (value) => { orderProjection = value; return chain; },
      lean: async () => [orderRecord]
    };
    return chain;
  });
  t.mock.method(Order, 'aggregate', async () => [{ orderCount: 4, totalSpentPaise: 481_400 }]);

  const app = express();
  app.get('/api/admin/customers/:id', getCustomerDetails);
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/customers/${customerId}`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(customerQuery, { _id: customerId, role: 'customer' });
  assert.deepEqual(addressQuery, { user: customerId });
  assert.deepEqual(orderQuery, { customer: customerId });
  assert.equal(orderLimit, 10);
  assert.match(orderProjection, /items/);
  assert.match(orderProjection, /paymentStatus/);
  assert.equal(body.customer.orderCount, 4);
  assert.equal(body.customer.totalSpent, 58);
  assert.equal(body.customer.addresses[0].city, 'Kolkata');
  assert.equal(body.customer.orders[0].orderStatus, 'Delivered');
  assert.equal(body.customer.orders.length, 1);
});
