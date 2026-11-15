export const SUPPORT_TICKET_STATUSES = [
  'Open',
  'Assigned',
  'In Progress',
  'Waiting for Customer',
  'Resolved',
  'Closed'
];

export const SUPPORT_TICKET_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

export function buildSupportTicketQuery({ page = 1, status = 'all', priority = 'all', search = '', assignedToMe = false } = {}) {
  const query = { page, limit: 20 };
  if (status !== 'all') query.status = status;
  if (priority !== 'all') query.priority = priority;
  if (search.trim()) query.search = search.trim();
  if (assignedToMe) query.assignedTo = 'me';
  return query;
}
