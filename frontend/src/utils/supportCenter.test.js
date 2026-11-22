import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupportTicketPayload, buildSupportTicketQuery, SUPPORT_TICKET_PRIORITIES, SUPPORT_TICKET_STATUSES } from './supportCenter.js';

test('support ticket filters omit unselected values and normalize search text', () => {
  assert.deepEqual(buildSupportTicketQuery({
    page: 3,
    status: 'Assigned',
    priority: 'Urgent',
    search: '  delivery  ',
    assignedToMe: true
  }), {
    page: 3,
    limit: 20,
    status: 'Assigned',
    priority: 'Urgent',
    search: 'delivery',
    assignedTo: 'me'
  });
  assert.deepEqual(buildSupportTicketQuery(), { page: 1, limit: 20 });
});

test('support filters cover the agreed ticket workflow and priorities', () => {
  assert.deepEqual(SUPPORT_TICKET_STATUSES, [
    'Open',
    'Assigned',
    'In Progress',
    'Waiting for Customer',
    'Resolved',
    'Closed'
  ]);
  assert.deepEqual(SUPPORT_TICKET_PRIORITIES, ['Low', 'Normal', 'High', 'Urgent']);
});

test('contact form builds a bounded authenticated support ticket payload', () => {
  assert.deepEqual(buildSupportTicketPayload({
    name: '  Riya  ',
    email: '  riya@example.test ',
    message: '  Please help with my delivery.  ',
    category: 'Delivery'
  }), {
    subject: 'Contact: Delivery',
    message: 'Name: Riya\nEmail: riya@example.test\n\nPlease help with my delivery.',
    priority: 'Normal'
  });
  assert.throws(() => buildSupportTicketPayload({
    name: '',
    email: 'invalid',
    message: 'short',
    category: 'Delivery'
  }), /contact/i);
});
