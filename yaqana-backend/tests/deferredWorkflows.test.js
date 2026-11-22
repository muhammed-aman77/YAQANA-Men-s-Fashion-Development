import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import AdminAudit from '../src/models/AdminAudit.js';
import Order from '../src/models/Order.js';
import ReturnRefund from '../src/models/ReturnRefund.js';
import User from '../src/models/User.js';
import Session from '../src/models/Session.js';
import { once } from 'node:events';
import { app } from '../src/app.js';
import { issueToken } from '../src/utils/token.js';
import { createReturnOrRefund, updateCodLifecycle, updateOrderShipment } from '../src/controllers/orderController.js';
import { getStaff, updateStaffPermissions } from '../src/controllers/adminController.js';
import { userHasPermission } from '../src/utils/staffAuthorization.js';

async function invoke(handler, req) {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let error;
  await handler(req, response, (nextError) => { error = nextError; });
  return { response, error };
}

test('return and refund endpoint is unavailable before reading an idempotency key or touching persistence', async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalFind = ReturnRefund.findOne;
  const originalCreate = ReturnRefund.create;
  mongoose.startSession = async () => { throw new Error('Deferred workflow must not open a transaction.'); };
  ReturnRefund.findOne = () => { throw new Error('Deferred workflow must not inspect an existing idempotency record.'); };
  ReturnRefund.create = () => { throw new Error('Deferred workflow must not create a record.'); };
  t.after(() => {
    mongoose.startSession = originalStartSession;
    ReturnRefund.findOne = originalFind;
    ReturnRefund.create = originalCreate;
  });

  for (const role of ['customer', 'support_agent', 'admin', 'owner']) {
    const result = await invoke(createReturnOrRefund, {
      user: { _id: `${role}-1`, role },
      get() { throw new Error('Deferred endpoint must not inspect idempotency keys.'); },
      body: { requestType: 'refund', amountPaise: 10000 }
    });
    assert.equal(result.error?.statusCode, 501, `${role} should receive Not Implemented`);
    assert.equal(result.error?.code, 'RETURN_REFUND_DEFERRED');
  }
});

test('authenticated customers and staff reach only the deferred return/refund response', async (t) => {
  const originalFindSession = Session.findOne;
  const originalFindUser = User.findById;
  Session.findOne = () => ({ select: async () => ({ revokedAt: null, expiresAt: new Date(Date.now() + 60_000), mfaVerifiedAt: new Date() }) });
  User.findById = async (id) => ({ _id: id, role: String(id).split('-')[0], status: 'active' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    Session.findOne = originalFindSession;
    User.findById = originalFindUser;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  for (const role of ['customer', 'support_agent', 'admin', 'owner']) {
    const userId = `${role}-integration`;
    const { token } = issueToken(userId);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/orders/507f1f77bcf86cd799439011/return-refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'refund', amountPaise: 1 })
    });
    assert.equal(response.status, 501, `${role} must not execute a deferred request`);
    assert.equal((await response.json()).code, 'RETURN_REFUND_DEFERRED');
  }
});

test('COD lifecycle and shipment endpoints stay unavailable without reading input or touching persistence', async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalFindById = Order.findById;
  const originalAuditCreate = AdminAudit.create;
  mongoose.startSession = async () => { throw new Error('Deferred order workflow must not open a transaction.'); };
  Order.findById = () => { throw new Error('Deferred order workflow must not read an order.'); };
  AdminAudit.create = () => { throw new Error('Deferred order workflow must not write an audit record.'); };
  t.after(() => {
    mongoose.startSession = originalStartSession;
    Order.findById = originalFindById;
    AdminAudit.create = originalAuditCreate;
  });

  for (const [handler, code] of [
    [updateCodLifecycle, 'COD_LIFECYCLE_DEFERRED'],
    [updateOrderShipment, 'SHIPMENT_WORKFLOW_DEFERRED']
  ]) {
    const request = {
      user: { _id: 'admin-1', role: 'admin' },
      params: { id: '507f1f77bcf86cd799439011' }
    };
    Object.defineProperty(request, 'body', {
      get() { throw new Error('Deferred order workflow must not read request input.'); }
    });
    const result = await invoke(handler, request);
    assert.equal(result.error?.statusCode, 501);
    assert.equal(result.error?.code, code);
  }
});

test('custom staff permission mutation is explicitly unavailable and performs no database work', async (t) => {
  const originalStartSession = mongoose.startSession;
  mongoose.startSession = async () => { throw new Error('Deferred permission editor must not open a transaction.'); };
  t.after(() => { mongoose.startSession = originalStartSession; });
  const result = await invoke(updateStaffPermissions, {
    user: { _id: 'admin-1', role: 'admin' },
    params: { id: '507f1f77bcf86cd799439011' },
    body: { customPermissions: ['inventory.adjust'], reason: 'Approved role change' }
  });
  assert.equal(result.error?.statusCode, 501);
  assert.equal(result.error?.code, 'CUSTOM_PERMISSIONS_DEFERRED');
});

test('legacy custom permission fields cannot grant access through the permission helper', () => {
  const legacySupportAgent = {
    role: 'support_agent',
    status: 'active',
    customPermissions: ['inventory.adjust', 'ownership.transfer']
  };
  assert.equal(userHasPermission(legacySupportAgent, 'inventory.adjust'), false);
  assert.equal(userHasPermission(legacySupportAgent, 'ownership.transfer'), false);
  assert.equal(userHasPermission({ ...legacySupportAgent, role: 'owner' }, 'ownership.transfer'), true);
});

test('staff response does not present unenforced custom permission assignments', async (t) => {
  const originalFind = User.find;
  User.find = () => ({
    sort() { return this; },
    select(fields) {
      assert.doesNotMatch(fields, /customPermissions/);
      return Promise.resolve([{ _id: 'staff-1', name: 'Staff', role: 'support_agent', customPermissions: ['inventory.adjust'] }]);
    }
  });
  t.after(() => { User.find = originalFind; });
  const result = await invoke(getStaff, { user: { role: 'admin' } });
  assert.equal(result.response.statusCode, 200);
  assert.equal(Object.hasOwn(result.response.body.staff[0], 'customPermissions'), false);
});
