import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import AdminAudit from '../src/models/AdminAudit.js';
import Session from '../src/models/Session.js';
import User from '../src/models/User.js';
import { updateCustomerStatus, updateSupportAgentRole } from '../src/controllers/adminController.js';

test('blocking a customer revokes sessions and records a secret-free before/after audit', async (t) => {
  const customer = { _id: '507f191e810c19729de860ea', name: 'Sample Customer', email: 'customer@example.test', status: 'active', async save() {} };
  const auditRecords = [];
  let revokedFilter;
  let revokedUpdate;
  t.mock.method(User, 'findOne', async (filter) => {
    assert.deepEqual(filter, { _id: customer._id, role: 'customer' });
    return customer;
  });
  t.mock.method(Session, 'updateMany', async (filter, update) => {
    revokedFilter = filter;
    revokedUpdate = update;
    return { modifiedCount: 2 };
  });
  t.mock.method(AdminAudit, 'create', async (record) => { auditRecords.push(record); });
  const res = { body: null, json(value) { this.body = value; return this; } };
  await updateCustomerStatus({
    params: { id: customer._id },
    body: { status: 'blocked' },
    user: { _id: 'admin-1', role: 'admin' }
  }, res, (error) => { throw error; });
  assert.equal(res.body.user.status, 'blocked');
  assert.deepEqual(revokedFilter, { user: customer._id, revokedAt: null });
  assert.ok(revokedUpdate.$set.revokedAt instanceof Date);
  const auditRecord = auditRecords.find(({ action }) => action === 'customer.status.update');
  assert.equal(auditRecords[0].action, 'customer.status.update.started');
  assert.equal(auditRecord.action, 'customer.status.update');
  assert.deepEqual(auditRecord.before, { status: 'active' });
  assert.deepEqual(auditRecord.after, { status: 'blocked' });
  assert.equal(auditRecord.metadata.revokedSessions, 2);
  assert.doesNotMatch(JSON.stringify(auditRecords), /password|token|mfaSecret|recoveryCode/iu);
});

test('customer status is not changed when its audit intent cannot be stored', async (t) => {
  let saved = false;
  const customer = { _id: '507f191e810c19729de860ea', status: 'active', async save() { saved = true; } };
  t.mock.method(User, 'findOne', async () => customer);
  t.mock.method(AdminAudit, 'create', async () => { throw new Error('audit unavailable'); });
  const response = { json() { return this; } };
  let forwardedError;
  await updateCustomerStatus({
    params: { id: customer._id }, body: { status: 'blocked' }, user: { _id: 'admin-1' }
  }, response, (error) => { forwardedError = error; });
  assert.match(forwardedError?.message || '', /audit unavailable/);
  assert.equal(saved, false);
  assert.equal(customer.status, 'active');
});

test('support-agent grant audit records the actual customer role before the grant', async (t) => {
  const account = {
    _id: '507f191e810c19729de860ea',
    role: 'customer',
    status: 'active',
    customPermissions: [],
    async save() {}
  };
  const auditRecords = [];
  const originalClient = mongoose.connection.client;
  mongoose.connection.client = { topology: { description: { type: 'ReplicaSetWithPrimary' } } };
  t.after(() => { mongoose.connection.client = originalClient; });
  t.mock.method(User, 'findById', () => ({ session: async () => account }));
  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (callback) => callback(),
    endSession: async () => {}
  }));
  t.mock.method(AdminAudit, 'create', async (records) => { auditRecords.push(...records); });

  const response = { body: null, json(value) { this.body = value; return this; } };
  await updateSupportAgentRole({
    params: { id: account._id },
    body: { enabled: true, reason: 'Assign support queue duties' },
    user: { _id: 'admin-1', role: 'admin' }
  }, response, (error) => { throw error; });

  assert.equal(response.body.staff.role, 'support_agent');
  assert.equal(auditRecords[0].before.role, 'customer');
  assert.equal(auditRecords[0].after.role, 'support_agent');
});
