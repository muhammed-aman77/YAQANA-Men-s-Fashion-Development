import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import InventoryApproval from '../src/models/InventoryApproval.js';
import InventoryPolicy from '../src/models/InventoryPolicy.js';
import { getAdminNotifications, updateAdminNotificationReadState } from '../src/controllers/adminController.js';

test('notification centre combines bounded live orders, reviewable inventory approvals, and non-demo low-stock products', async (t) => {
  const orderId = '507f191e810c19729de860ea';
  const order = { _id: orderId, customer: { name: 'Sample Customer', email: 'private@example.test' }, orderStatus: 'Pending', createdAt: new Date('2026-11-20T10:00:00Z') };
  const approval = { _id: 'approval-1', sku: 'TEE-M', productName: 'Core Tee', quantityDelta: -20, requestedBy: { name: 'Other Admin' }, createdAt: new Date('2026-11-20T09:00:00Z') };
  const lowStock = { _id: 'product-1', name: 'Oxford Shirt', active: true, stock: 900, updatedAt: new Date('2026-11-20T08:00:00Z'), variants: [
    { sku: 'OX-S', status: 'active', stock: 12, reservedQuantity: 8 },
    { sku: 'OX-M', status: 'active', stock: 40, reservedQuantity: 0 }
  ] };
  const staleAggregateLow = { _id: 'product-2', name: 'Stale Aggregate', active: true, stock: 1, variants: [
    { sku: 'STALE-S', status: 'active', stock: 30, reservedQuantity: 0 }
  ] };
  const rowLimits = [];
  t.mock.method(Order, 'find', (query) => {
    assert.deepEqual(query.orderStatus.$in, ['Pending', 'Confirmed', 'Processing']);
    const chain = {
      sort: () => chain,
      limit: (value) => { rowLimits.push(value); return chain; },
      select: () => chain,
      populate: () => chain,
      lean: async () => [order]
    };
    return chain;
  });
  t.mock.method(Order, 'countDocuments', async () => 25);
  t.mock.method(InventoryApproval, 'find', (query) => {
    assert.equal(query.status, 'pending');
    assert.equal(query.approvalLevel, 'admin');
    assert.equal(query.requestedBy.$ne, 'admin-1');
    const chain = { sort: () => chain, limit: (value) => { rowLimits.push(value); return chain; }, select: () => chain, populate: () => chain, lean: async () => [approval] };
    return chain;
  });
  t.mock.method(InventoryApproval, 'countDocuments', async () => 3);
  t.mock.method(InventoryPolicy, 'findOne', (query) => {
    assert.deepEqual(query, { scope: 'global' });
    return { lean: async () => ({ lowStockThreshold: 5, criticalStockThreshold: 2 }) };
  });
  t.mock.method(Product, 'find', (query) => {
    assert.equal(query.isDemoData.$ne, true);
    assert.equal(query.active.$ne, false);
    assert.equal(query.stock, undefined);
    const chain = { select: () => chain, lean: async () => [lowStock, staleAggregateLow] };
    return chain;
  });
  t.mock.method(Product, 'countDocuments', () => assert.fail('low-stock count must come from SKU availability'));
  const app = express();
  app.use((req, _res, next) => { req.user = { _id: 'admin-1' }; next(); });
  app.get('/admin/notifications', getAdminNotifications);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/notifications`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(rowLimits, [20, 20]);
  assert.equal(body.source, 'live_orders_and_inventory');
  assert.equal(body.totalCount, 29);
  assert.deepEqual(body.notifications.map(({ type }) => type), ['pending_order', 'inventory_approval', 'low_stock']);
  assert.equal(body.notifications[0].section, 'orders');
  assert.equal(body.notifications[0].isRead, false);
  assert.equal(body.unreadCount, 3);
  assert.equal(body.notifications[0].searchTerm, orderId);
  assert.equal(body.notifications[1].section, 'inventory');
  assert.equal(body.notifications[1].searchTerm, 'TEE-M');
  assert.equal(body.notifications[2].searchTerm, 'Oxford Shirt');
  assert.equal(body.notifications[2].detail, 'OX-S: 4 available');
  assert.equal(JSON.stringify(body).includes(order.customer.email), false);
});

test('notification read state is persisted per admin preference and reflected by subsequent reads', async (t) => {
  const order = { _id: '507f191e810c19729de860ea', customer: { name: 'Customer' }, orderStatus: 'Pending', createdAt: new Date() };
  const user = { _id: 'admin-1', role: 'admin', adminPreferences: { notificationStates: [] }, async save() {} };
  const chain = (result) => ({ sort: () => chain(result), limit: () => chain(result), select: () => chain(result), populate: () => chain(result), lean: async () => result });
  t.mock.method(Order, 'find', () => chain([order]));
  t.mock.method(Order, 'countDocuments', async () => 1);
  t.mock.method(InventoryApproval, 'find', () => chain([]));
  t.mock.method(InventoryApproval, 'countDocuments', async () => 0);
  t.mock.method(InventoryPolicy, 'findOne', () => ({ lean: async () => ({ lowStockThreshold: 10 }) }));
  t.mock.method(Product, 'find', () => chain([]));
  t.mock.method(Product, 'countDocuments', async () => 0);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.get('/notifications', getAdminNotifications);
  app.put('/notifications/read-state', updateAdminNotificationReadState);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}/notifications`;
  let response = await fetch(base);
  let body = await response.json();
  assert.equal(body.notifications[0].isRead, false);
  const notificationId = body.notifications[0].id;
  response = await fetch(`${base}/read-state`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notificationId, isRead: true }) });
  assert.equal(response.status, 200);
  assert.equal(user.adminPreferences.notificationStates[0].notificationId, notificationId);
  assert.ok(user.adminPreferences.notificationStates[0].readAt instanceof Date);
  response = await fetch(base);
  body = await response.json();
  assert.equal(body.notifications[0].isRead, true);
  assert.equal(body.unreadCount, 0);
  response = await fetch(`${base}/read-state`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notificationId, isRead: false }) });
  assert.equal(response.status, 200);
  assert.deepEqual(user.adminPreferences.notificationStates, []);
});
