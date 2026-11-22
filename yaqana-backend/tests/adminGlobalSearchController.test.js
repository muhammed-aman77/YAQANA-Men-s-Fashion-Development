import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import Product from '../src/models/Product.js';
import Order from '../src/models/Order.js';
import User from '../src/models/User.js';
import { getAdminGlobalSearch } from '../src/controllers/adminController.js';

function queryChain(value) {
  const query = {
    sort() { return query; },
    limit(amount) { query.limitAmount = amount; return query; },
    select(selection) { query.selection = selection; return query; },
    populate() { return query; },
    lean: async () => value
  };
  return query;
}

test('admin global search returns capped entities without exposing customer contact details', async (t) => {
  const customer = { _id: '507f1f77bcf86cd799439011', name: 'Aman Customer', email: 'private@example.test', phone: '+919999999999' };
  const product = { _id: '507f191e810c19729de860ea', name: 'Linen Shirt', category: 'Shirts', status: 'active', isDemoData: true };
  const order = { _id: '507f191e810c19729de860eb', customer: { name: customer.name }, orderStatus: 'Processing', createdAt: new Date() };
  let customerQuery;
  let productQuery;
  let orderQuery;
  t.mock.method(User, 'find', (filter) => { customerQuery = filter; return queryChain([customer]); });
  t.mock.method(Product, 'find', (filter) => { productQuery = filter; return queryChain([product]); });
  t.mock.method(Order, 'find', (filter) => { orderQuery = filter; return queryChain([order]); });
  const app = express();
  app.get('/admin/search', getAdminGlobalSearch);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/search?q=${encodeURIComponent('Aman.*')}`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(customerQuery.role, 'customer');
  assert.ok(productQuery.active);
  assert.equal(orderQuery.$or[0].customer.$in[0], customer._id);
  assert.equal(body.results.length, 3);
  assert.equal(body.results.find((result) => result.type === 'product').demo, true);
  assert.equal(JSON.stringify(body).includes(customer.email), false);
  assert.equal(JSON.stringify(body).includes(customer.phone), false);
});

test('admin global search rejects short terms before querying any model', async (t) => {
  t.mock.method(User, 'find', () => { throw new Error('Must not query for an invalid term.'); });
  const app = express();
  app.get('/admin/search', getAdminGlobalSearch);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/search?q=x`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'INVALID_SEARCH');
});
