import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupportTicketQuery, SUPPORT_TICKET_PRIORITIES, SUPPORT_TICKET_STATUSES } from './supportCenter.js';

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
