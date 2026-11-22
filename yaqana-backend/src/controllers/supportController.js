import mongoose from 'mongoose';
import Order from '../models/Order.js';
import SupportTicket, { SUPPORT_PRIORITIES, SUPPORT_STATUSES } from '../models/SupportTicket.js';
import User from '../models/User.js';
import AdminAudit from '../models/AdminAudit.js';
import { asyncHandler, httpError } from '../utils/http.js';

const isAdmin = (user) => ['admin', 'owner'].includes(user?.role);
const isSupportAgent = (user) => user?.role === 'support_agent';
const validStatus = (value) => SUPPORT_STATUSES.includes(value);
const validPriority = (value) => SUPPORT_PRIORITIES.includes(value);
const ticketPopulate = [
  { path: 'customer', select: 'name email phone' },
  { path: 'assignedTo', select: 'name email' },
  { path: 'order', select: 'orderStatus paymentStatus createdAt totalPaise' },
  { path: 'history.actor', select: 'name email role' }
];

function serializeTicket(ticket, viewer) {
  const data = ticket.toObject ? ticket.toObject({ virtuals: true }) : ticket;
  if (!isAdmin(viewer)) {
    data.history = data.history.filter((entry) => entry.visibility === 'public');
  }
  return data;
}

async function loadTicket(id, user) {
  if (!mongoose.isValidObjectId(id)) throw httpError(404, 'Support ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
  const filter = { _id: id };
  if (!isAdmin(user)) filter.customer = user._id;
  if (isSupportAgent(user)) {
    delete filter.customer;
    filter.assignedTo = user._id;
  }
  const ticket = await SupportTicket.findOne(filter).populate(ticketPopulate);
  if (!ticket) throw httpError(404, 'Support ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
  return ticket;
}

async function findCustomer(user, customerId) {
  if (!isAdmin(user) && customerId && String(customerId) !== String(user._id)) {
    throw httpError(403, 'You can only create a ticket for your own account.', 'SUPPORT_CUSTOMER_FORBIDDEN');
  }
  if (!customerId) return user;
  if (!mongoose.isValidObjectId(customerId)) throw httpError(400, 'Customer account is invalid.');
  const customer = await User.findOne({
    _id: customerId,
    status: 'active',
    $or: [{ role: 'customer' }, { _id: isAdmin(user) ? user._id : null }]
  });
  if (!customer) throw httpError(404, 'Customer account was not found or is unavailable.');
  return customer;
}

async function findOrder(orderId, customerId) {
  if (!orderId) return null;
  if (!mongoose.isValidObjectId(orderId)) throw httpError(400, 'Order reference is invalid.');
  const order = await Order.findOne({ _id: orderId, customer: customerId }).select('_id');
  if (!order) throw httpError(404, 'Order was not found for this customer.');
  return order._id;
}

export const createSupportTicket = asyncHandler(async (req, res) => {
  if (isSupportAgent(req.user)) throw httpError(403, 'Support agents cannot create tickets for other customers.', 'SUPPORT_AGENT_CUSTOMER_ACTION_FORBIDDEN');
  const subject = String(req.body?.subject || '').trim();
  const message = String(req.body?.message || '').trim();
  if (subject.length < 4 || subject.length > 150) throw httpError(400, 'Ticket subject must be between 4 and 150 characters.');
  if (message.length < 5 || message.length > 5000) throw httpError(400, 'Describe the issue in 5 to 5000 characters.');
  const priority = req.body?.priority || 'Normal';
  if (!validPriority(priority)) throw httpError(400, 'Ticket priority is invalid.');

  const customer = await findCustomer(req.user, req.body?.customerId);
  const order = await findOrder(req.body?.orderId, customer._id);
  let assignedTo = null;
  if (req.body?.assignedTo) {
    if (!isAdmin(req.user)) throw httpError(403, 'Only administrators can assign support tickets.', 'ADMIN_REQUIRED');
    assignedTo = await User.findOne({ _id: req.body.assignedTo, role: 'admin', status: 'active' }).select('_id');
    if (!assignedTo) throw httpError(400, 'Choose an active administrator for assignment.');
  }

  const status = assignedTo ? 'Assigned' : 'Open';
  if (isAdmin(req.user)) {
    await AdminAudit.create({
      actor: req.user._id,
      action: 'support.ticket.create.started',
      reason: 'Administrator started a support ticket creation.',
      before: null,
      after: { status, priority, assignedTo: String(assignedTo?._id || '') },
      metadata: { phase: 'intent', customerId: String(customer._id), orderLinked: Boolean(order), subjectLogged: false, messageLogged: false }
    });
  }

  const ticket = await SupportTicket.create({
    customer: customer._id,
    order,
    subject,
    priority,
    status: assignedTo ? 'Assigned' : 'Open',
    assignedTo: assignedTo?._id || null,
    history: [{ type: 'created', actor: req.user._id, body: message, visibility: 'public' }]
  });
  if (isAdmin(req.user)) {
    await AdminAudit.create({
      actor: req.user._id,
      action: 'support.ticket.create',
      reason: 'Administrator created a support ticket.',
      before: null,
      after: { status: ticket.status, priority: ticket.priority, assignedTo: String(ticket.assignedTo || '') },
      metadata: { phase: 'completed', targetId: String(ticket._id), customerId: String(customer._id), orderLinked: Boolean(order), subjectLogged: false, messageLogged: false }
    });
  }
  const populated = await SupportTicket.findById(ticket._id).populate(ticketPopulate);
  res.status(201).json({ success: true, ticket: serializeTicket(populated, req.user) });
});

export const getSupportTickets = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query?.limit, 10) || 20));
  const filter = {};
  if (!isAdmin(req.user)) filter.customer = req.user._id;
  if (isSupportAgent(req.user)) {
    delete filter.customer;
    filter.assignedTo = req.user._id;
  }
  if (req.query?.status && req.query.status !== 'all') {
    if (!validStatus(req.query.status)) throw httpError(400, 'Ticket status filter is invalid.');
    filter.status = req.query.status;
  }
  if (req.query?.priority && req.query.priority !== 'all') {
    if (!validPriority(req.query.priority)) throw httpError(400, 'Ticket priority filter is invalid.');
    filter.priority = req.query.priority;
  }
  if (isAdmin(req.user) && req.query?.assignedTo === 'me') filter.assignedTo = req.user._id;
  const search = String(req.query?.search || '').trim().slice(0, 100);
  if (search) {
    const term = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const historySearch = isAdmin(req.user)
      ? { body: term }
      : { body: term, visibility: 'public' };
    const clauses = [{ subject: term }, { history: { $elemMatch: historySearch } }];
    if (isAdmin(req.user)) {
      const users = await User.find({
        role: 'customer',
        $or: [{ name: term }, { email: term }]
      }).select('_id');
      if (users.length) clauses.push({ customer: { $in: users.map(({ _id }) => _id) } });
    }
    if (mongoose.isValidObjectId(search)) clauses.push({ _id: search });
    filter.$or = clauses;
  }

  const [tickets, totalCount] = await Promise.all([
    SupportTicket.find(filter).sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * limit).limit(limit).populate(ticketPopulate),
    SupportTicket.countDocuments(filter)
  ]);
  res.json({
    success: true,
    tickets: tickets.map((ticket) => serializeTicket(ticket, req.user)),
    totalCount,
    currentPage: page,
    totalPages: Math.ceil(totalCount / limit)
  });
});

export const getSupportTicket = asyncHandler(async (req, res) => {
  const ticket = await loadTicket(req.params.id, req.user);
  res.json({ success: true, ticket: serializeTicket(ticket, req.user) });
});

export const updateSupportTicket = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user) && !isSupportAgent(req.user)) throw httpError(403, 'Support or administrator access is required.', 'SUPPORT_PERMISSION_REQUIRED');
  const { status, priority, assignedTo, internalNote } = req.body || {};
  if (status === undefined && priority === undefined && assignedTo === undefined && internalNote === undefined) {
    throw httpError(400, 'Provide a status, priority, assignee, or internal note to update.');
  }
  if (!isAdmin(req.user) && (priority !== undefined || assignedTo !== undefined || internalNote !== undefined)) {
    throw httpError(403, 'Support agents cannot change priority, assignment, or add internal notes.', 'SUPPORT_PERMISSION_FORBIDDEN');
  }
  if (status !== undefined && !validStatus(status)) throw httpError(400, 'Ticket status is invalid.');
  if (priority !== undefined && !validPriority(priority)) throw httpError(400, 'Ticket priority is invalid.');
  if (internalNote !== undefined && (typeof internalNote !== 'string' || internalNote.trim().length < 2 || internalNote.trim().length > 5000)) {
    throw httpError(400, 'Internal notes must be between 2 and 5000 characters.');
  }

  const ticket = await loadTicket(req.params.id, req.user);
  const auditBefore = { status: ticket.status, priority: ticket.priority, assignedTo: String(ticket.assignedTo?._id || ticket.assignedTo || '') };
  if (status !== undefined && status !== ticket.status) {
    const previousStatus = ticket.status;
    ticket.status = status;
    ticket.history.push({
      type: 'status_changed',
      actor: req.user._id,
      body: `Status changed from ${previousStatus} to ${status}.`,
      visibility: 'public'
    });
  }
  if (priority !== undefined && priority !== ticket.priority) {
    const previousPriority = ticket.priority;
    ticket.priority = priority;
    ticket.history.push({
      type: 'priority_changed',
      actor: req.user._id,
      body: `Priority changed from ${previousPriority} to ${priority}.`,
      visibility: 'internal'
    });
  }
  if (assignedTo !== undefined) {
    const nextAssignee = assignedTo === '' || assignedTo === null
      ? null
      : await User.findOne({ _id: assignedTo, role: 'admin', status: 'active' }).select('_id name');
    if (assignedTo && !nextAssignee) throw httpError(400, 'Choose an active administrator for assignment.');
    const previousAssignee = ticket.assignedTo?._id || ticket.assignedTo;
    if (String(previousAssignee || '') !== String(nextAssignee?._id || '')) {
      ticket.assignedTo = nextAssignee?._id || null;
      ticket.history.push({
        type: 'assigned',
        actor: req.user._id,
        body: nextAssignee ? `Assigned to ${nextAssignee.name}.` : 'Ticket assignment cleared.',
        visibility: 'internal'
      });
      if (status === undefined && nextAssignee && ticket.status === 'Open') ticket.status = 'Assigned';
      if (status === undefined && !nextAssignee && ticket.status === 'Assigned') ticket.status = 'Open';
    }
  }
  if (internalNote !== undefined) {
    ticket.history.push({
      type: 'internal_note',
      actor: req.user._id,
      body: internalNote.trim(),
      visibility: 'internal'
    });
  }
  if (ticket.status === 'Assigned' && !ticket.assignedTo) {
    throw httpError(400, 'Assign the ticket to an active administrator before using the Assigned status.');
  }

  const auditAfter = { status: ticket.status, priority: ticket.priority, assignedTo: String(ticket.assignedTo?._id || ticket.assignedTo || '') };
  const auditTarget = String(ticket._id);
  const auditState = { ...auditAfter, internalNoteAdded: internalNote !== undefined };
  await AdminAudit.create({
    actor: req.user._id,
    action: 'support.ticket.update.started',
    reason: 'Staff started a support ticket update.',
    before: auditBefore,
    after: auditState,
    metadata: { targetId: auditTarget, internalNoteContentLogged: false, phase: 'intent' }
  });
  await ticket.save();
  await AdminAudit.create({
    actor: req.user._id,
    action: 'support.ticket.update',
    reason: 'Support ticket fields updated by staff',
    before: auditBefore,
    after: auditState,
    metadata: { targetId: auditTarget, internalNoteContentLogged: false, phase: 'completed' }
  });
  const populated = await SupportTicket.findById(ticket._id).populate(ticketPopulate);
  res.json({ success: true, ticket: serializeTicket(populated, req.user) });
});

export const addSupportReply = asyncHandler(async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (message.length < 2 || message.length > 5000) throw httpError(400, 'Replies must be between 2 and 5000 characters.');
  const ticket = await loadTicket(req.params.id, req.user);
  if (ticket.status === 'Closed') throw httpError(409, 'Closed tickets cannot receive replies.');
  ticket.history.push({ type: 'reply', actor: req.user._id, body: message, visibility: 'public' });
  if (isAdmin(req.user) || isSupportAgent(req.user)) {
    const targetId = String(ticket._id);
    const historyCountBefore = ticket.history.length - 1;
    await AdminAudit.create({
      actor: req.user._id,
      action: 'support.ticket.reply.started',
      reason: 'Staff started a support ticket reply.',
      before: { status: ticket.status, historyCount: historyCountBefore },
      after: { status: ticket.status, historyCount: ticket.history.length },
      metadata: { targetId, phase: 'intent', replyContentLogged: false, replyLength: message.length }
    });
    await ticket.save();
    await AdminAudit.create({
      actor: req.user._id,
      action: 'support.ticket.reply',
      reason: 'Staff replied to a support ticket.',
      before: { status: ticket.status, historyCount: historyCountBefore },
      after: { status: ticket.status, historyCount: ticket.history.length },
      metadata: { targetId, phase: 'completed', replyContentLogged: false, replyLength: message.length }
    });
  } else {
    await ticket.save();
  }
  const populated = await SupportTicket.findById(ticket._id).populate(ticketPopulate);
  res.status(201).json({ success: true, ticket: serializeTicket(populated, req.user) });
});

export const getSupportAssignees = asyncHandler(async (_req, res) => {
  const assignees = await User.find({ role: 'admin', status: 'active' }).select('name email role').sort({ name: 1 }).lean();
  res.json({ success: true, assignees });
});
