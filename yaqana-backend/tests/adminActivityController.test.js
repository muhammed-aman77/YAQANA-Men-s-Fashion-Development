import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import AdminAudit from '../src/models/AdminAudit.js';
import Order from '../src/models/Order.js';
import ProductDeletionAudit from '../src/models/ProductDeletionAudit.js';
import StockMovement from '../src/models/StockMovement.js';
import { getAdminActivity } from '../src/controllers/adminController.js';

function modelRead(model, rows) {
  return (query) => {
    const chain = {
      sort: () => chain,
      limit: () => chain,
      populate: () => chain,
      lean: async () => rows
    };
    chain.query = query;
    return chain;
  };
}

test('admin activity feed combines persisted audit, movement, deletion, and order history events', async (t) => {
  t.mock.method(AdminAudit, 'find', modelRead(AdminAudit, [
    { _id: 'audit-catalog', action: 'catalog.product.update', createdAt: new Date('2026-11-20T11:00:00Z'), actor: { name: 'Admin' }, metadata: { targetId: 'product-1', productName: 'Core Tee' } },
    { _id: 'audit-1', action: 'staff.permissions.updated', createdAt: new Date('2026-11-20T10:00:00Z'), actor: { name: 'Admin' }, metadata: {} }
  ]));
  t.mock.method(StockMovement, 'find', modelRead(StockMovement, [{ _id: 'movement-1', type: 'adjustment', createdAt: new Date('2026-11-20T09:00:00Z'), changes: [{ sku: 'TEE-M', productName: 'Tee' }], performedBy: { name: 'Admin' } }]));
  t.mock.method(ProductDeletionAudit, 'find', modelRead(ProductDeletionAudit, [{ _id: 'delete-1', deletedAt: new Date('2026-11-20T08:00:00Z'), productName: 'Old Tee', performedBy: { name: 'Admin' } }]));
  t.mock.method(Order, 'aggregate', async () => [{ _id: 'order-1', orderId: 'order-1', status: 'Shipped', changedAt: new Date('2026-11-20T07:00:00Z'), actorName: 'Admin' }]);
  const app = express();
  app.get('/admin/activity', getAdminActivity);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/activity`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.source, 'database_audit_records');
  assert.deepEqual(body.events.map((event) => event.type), ['admin_audit', 'admin_audit', 'inventory_movement', 'product_deletion', 'order_status']);
  assert.equal(body.events[0].section, 'products');
  assert.equal(body.events[0].searchTerm, 'Core Tee');
  assert.equal(body.events[1].section, 'settings');
  assert.equal(body.events[2].searchTerm, 'TEE-M');
});
