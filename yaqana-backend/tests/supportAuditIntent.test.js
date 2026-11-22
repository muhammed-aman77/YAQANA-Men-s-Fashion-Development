import test from 'node:test';
import assert from 'node:assert/strict';
import AdminAudit from '../src/models/AdminAudit.js';
import SupportTicket from '../src/models/SupportTicket.js';
import User from '../src/models/User.js';
import { addSupportReply, createSupportTicket, getSupportAssignees, updateSupportTicket } from '../src/controllers/supportController.js';

test('support ticket mutation is blocked when audit intent cannot be persisted', async (t) => {
  const ticket = {
    _id: '507f191e810c19729de860ea', status: 'Open', priority: 'Normal', assignedTo: null, history: [],
    async save() { this.saved = true; }
  };
  t.mock.method(SupportTicket, 'findOne', () => ({ populate: async () => ticket }));
  t.mock.method(AdminAudit, 'create', async () => { throw new Error('audit storage unavailable'); });
  const response = { json(body) { this.body = body; return this; } };
  let forwardedError;

  await updateSupportTicket({
    params: { id: ticket._id }, body: { status: 'Closed' },
    user: { _id: '507f191e810c19729de860eb', role: 'admin' }
  }, response, (error) => { forwardedError = error; });

  assert.match(forwardedError?.message || '', /audit storage unavailable/);
  assert.equal(ticket.saved, undefined);
  assert.equal(ticket.status, 'Closed');
});

test('staff reply is blocked when its audit intent cannot be persisted', async (t) => {
  const ticket = {
    _id: '507f191e810c19729de860ea', status: 'Open', history: [],
    async save() { this.saved = true; }
  };
  t.mock.method(SupportTicket, 'findOne', () => ({ populate: async () => ticket }));
  t.mock.method(AdminAudit, 'create', async () => { throw new Error('audit storage unavailable'); });
  const response = { status() { return this; }, json(value) { this.body = value; return this; } };
  let forwardedError;

  await addSupportReply({
    params: { id: ticket._id }, body: { message: 'We have reviewed the issue.' },
    user: { _id: '507f191e810c19729de860eb', role: 'admin' }
  }, response, (error) => { forwardedError = error; });

  assert.match(forwardedError?.message || '', /audit storage unavailable/);
  assert.equal(ticket.saved, undefined);
  assert.equal(ticket.history.length, 1);
  assert.equal(ticket.history[0].body, 'We have reviewed the issue.');
});

test('administrator-created ticket is blocked when its audit intent cannot be persisted', async (t) => {
  const customer = { _id: '507f191e810c19729de860ec' };
  let created = false;
  t.mock.method(User, 'findOne', async () => customer);
  t.mock.method(AdminAudit, 'create', async () => { throw new Error('audit storage unavailable'); });
  t.mock.method(SupportTicket, 'create', async () => { created = true; });
  const response = { status() { return this; }, json(value) { this.body = value; return this; } };
  let forwardedError;

  await createSupportTicket({
    body: { subject: 'Order support', message: 'Please review my order.' },
    user: { _id: '507f191e810c19729de860eb', role: 'admin' }
  }, response, (error) => { forwardedError = error; });

  assert.match(forwardedError?.message || '', /audit storage unavailable/);
  assert.equal(created, false);
});

test('support assignee list matches the administrator role accepted by assignment endpoints', async (t) => {
  const eligibleAdmins = [{ _id: '507f191e810c19729de860ed', role: 'admin' }];
  t.mock.method(User, 'find', (filter) => {
    assert.deepEqual(filter, { role: 'admin', status: 'active' });
    return {
      select() { return this; },
      sort() { return this; },
      lean: async () => eligibleAdmins
    };
  });
  const response = { json(value) { this.body = value; return this; } };

  await getSupportAssignees({}, response, (error) => { throw error; });

  assert.deepEqual(response.body.assignees, eligibleAdmins);
});
