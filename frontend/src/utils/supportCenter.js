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

export function buildSupportTicketPayload({ name = '', email = '', message = '', category = 'General' } = {}) {
  const safeName = String(name).trim().slice(0, 100);
  const safeEmail = String(email).trim().toLowerCase().slice(0, 254);
  const safeMessage = String(message).trim().slice(0, 5000);
  const safeCategory = String(category).trim() || 'General';
  if (safeName.length < 2) throw new Error('Please enter a valid contact name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) throw new Error('Please enter a valid contact email.');
  if (safeMessage.length < 5) throw new Error('Please enter a contact message of at least 5 characters.');
  return {
    subject: `Contact: ${safeCategory.slice(0, 100)}`,
    message: `Name: ${safeName}\nEmail: ${safeEmail}\n\n${safeMessage}`,
    priority: 'Normal'
  };
}
