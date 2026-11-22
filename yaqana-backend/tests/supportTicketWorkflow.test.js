import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Order from '../src/models/Order.js';
import Session from '../src/models/Session.js';
import SupportTicket from '../src/models/SupportTicket.js';
import User from '../src/models/User.js';
import AdminAudit from '../src/models/AdminAudit.js';
import { app } from '../src/app.js';
import { issueToken } from '../src/utils/token.js';
import {
  addSupportReply,
  createSupportTicket,
  getSupportTicket,
  getSupportTickets,
  updateSupportTicket
} from '../src/controllers/supportController.js';

const localDatabaseUri = 'mongodb://127.0.0.1:27017/yaqana_local_dev_20261115';

test('support tickets persist status, assignment, replies and private notes with customer authorization', {
  skip: process.env.RUN_LOCAL_DB_TESTS !== '1'
}, async (t) => {
  await mongoose.connect(localDatabaseUri, { serverSelectionTimeoutMS: 3000 });
  const suffix = randomUUID().replace(/-/g, '');
  const customerEmail = `support-test-${suffix}@example.local`;
  let customer;
  let order;
  let ticketId;
  let admin;
  let server;
  const sessionIds = [];

  t.after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    if (sessionIds.length) await Session.deleteMany({ jti: { $in: sessionIds } });
    if (ticketId) await SupportTicket.deleteOne({ _id: ticketId });
    if (ticketId) await AdminAudit.deleteMany({ action: 'support.ticket.update', 'metadata.targetId': String(ticketId) });
    if (order) await Order.deleteOne({ _id: order._id });
    if (customer) await User.deleteOne({ _id: customer._id, email: customerEmail });
    await mongoose.disconnect();
  });

  admin = await User.findOne({ role: 'admin', status: 'active' }).select('_id name email role');
  assert.ok(admin, 'the local development database must contain an active administrator');
  customer = await User.create({
    name: 'Temporary Support Customer',
    email: customerEmail,
    passwordHash: 'test-fixture-only',
    role: 'customer',
    status: 'active'
  });
  order = await Order.create({
    customer: customer._id,
    items: [{
      product: new mongoose.Types.ObjectId(),
      name: 'Support workflow fixture',
      pricePaise: 10000,
      quantity: 1,
      size: 'M',
      colour: 'Black'
    }],
    shippingAddress: {
      fullName: customer.name,
      phone: '9876543210',
      addressLine1: '12 Test Road',
      city: 'Kolkata',
      state: 'West Bengal',
      postalCode: '700001'
    },
    paymentMethod: 'Cash on Delivery',
    paymentStatus: 'Pending',
    orderStatus: 'Confirmed',
    subtotalPaise: 10000,
    totalPaise: 10000
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

  const created = await invoke(createSupportTicket, {
    user: customer,
    body: {
      subject: `Order delivery question ${suffix}`,
      message: 'Please confirm the expected delivery window.',
      orderId: String(order._id),
      priority: 'High'
    }
  });
  assert.ifError(created.error);
  assert.equal(created.response.statusCode, 201);
  ticketId = created.response.body.ticket._id;

  const updated = await invoke(updateSupportTicket, {
    user: admin,
    params: { id: String(ticketId) },
    body: {
      status: 'Assigned',
      priority: 'Urgent',
      assignedTo: String(admin._id),
      internalNote: 'Asked the fulfilment team to verify the dispatch estimate.'
    }
  });
  assert.ifError(updated.error);
  assert.equal(updated.response.body.ticket.status, 'Assigned');
  assert.equal(String(updated.response.body.ticket.assignedTo._id), String(admin._id));
  const audit = await AdminAudit.findOne({ action: 'support.ticket.update', 'metadata.targetId': String(ticketId) }).lean();
  assert.equal(audit.before.status, 'Open');
  assert.equal(audit.after.status, 'Assigned');
  assert.equal(audit.metadata.internalNoteContentLogged, false);

  const reply = await invoke(addSupportReply, {
    user: customer,
    params: { id: String(ticketId) },
    body: { message: 'Thank you; I will wait for the update.' }
  });
  assert.ifError(reply.error);

  const customerDetail = await invoke(getSupportTicket, {
    user: customer,
    params: { id: String(ticketId) }
  });
  assert.ifError(customerDetail.error);
  assert.equal(customerDetail.response.body.ticket.status, 'Assigned');
  assert.equal(customerDetail.response.body.ticket.order.orderStatus, 'Confirmed');
  assert.equal(
    customerDetail.response.body.ticket.history.some(({ body }) => body.includes('fulfilment team')),
    false
  );
  assert.equal(
    customerDetail.response.body.ticket.history.some(({ body }) => body.includes('wait for the update')),
    true
  );

  const forbiddenUpdate = await invoke(updateSupportTicket, {
    user: customer,
    params: { id: String(ticketId) },
    body: { status: 'Closed', internalNote: 'Customer must not add internal notes.' }
  });
  assert.equal(forbiddenUpdate.error?.statusCode, 403);

  const listed = await invoke(getSupportTickets, {
    user: customer,
    query: { status: 'Assigned', priority: 'Urgent', search: suffix, page: '1', limit: '10' }
  });
  assert.ifError(listed.error);
  assert.equal(listed.response.body.totalCount, 1);
  assert.equal(String(listed.response.body.tickets[0]._id), String(ticketId));
  assert.equal(listed.response.body.tickets[0].history.some(({ body }) => body.includes('fulfilment team')), false);

  const persisted = await SupportTicket.findById(ticketId).lean();
  assert.equal(persisted.status, 'Assigned');
  assert.equal(persisted.priority, 'Urgent');
  assert.equal(persisted.order.toString(), String(order._id));
  assert.equal(persisted.history.some(({ body, visibility }) => visibility === 'internal' && body.includes('fulfilment team')), true);

  const customerSession = issueToken(customer._id);
  const adminSession = issueToken(admin._id);
  sessionIds.push(customerSession.jti, adminSession.jti);
  await Session.create([
    { user: customer._id, jti: customerSession.jti, expiresAt: customerSession.expiresAt },
    {
      user: admin._id,
      jti: adminSession.jti,
      expiresAt: adminSession.expiresAt,
      mfaVerifiedAt: new Date()
    }
  ]);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}/api/support`;
  const apiRequest = (path, token, options = {}) => fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  const unauthenticated = await apiRequest('/tickets', null);
  assert.equal(unauthenticated.status, 401);
  const customerAssignees = await apiRequest('/assignees', customerSession.token);
  assert.equal(customerAssignees.status, 403);
  const customerList = await apiRequest('/tickets', customerSession.token);
  assert.equal(customerList.status, 200);
  const customerListBody = await customerList.json();
  assert.equal(customerListBody.totalCount, 1);
  assert.equal(customerListBody.tickets[0].history.some(({ body }) => body.includes('fulfilment team')), false);
  const internalNoteSearch = await apiRequest('/tickets?search=fulfilment%20team', customerSession.token);
  assert.equal((await internalNoteSearch.json()).totalCount, 0);
  const adminAssignees = await apiRequest('/assignees', adminSession.token);
  assert.equal(adminAssignees.status, 200);
  const customerMutation = await apiRequest(`/tickets/${ticketId}`, customerSession.token, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'Closed' })
  });
  assert.equal(customerMutation.status, 403);
});
