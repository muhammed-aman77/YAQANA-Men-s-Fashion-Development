import mongoose from 'mongoose';

export const SUPPORT_STATUSES = [
  'Open',
  'Assigned',
  'In Progress',
  'Waiting for Customer',
  'Resolved',
  'Closed'
];

export const SUPPORT_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

const historySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['created', 'status_changed', 'priority_changed', 'assigned', 'reply', 'internal_note'],
    required: true
  },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, trim: true, maxlength: 5000 },
  visibility: { type: String, enum: ['public', 'internal'], default: 'public' },
  at: { type: Date, default: Date.now }
}, { _id: true });

const supportTicketSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  subject: { type: String, required: true, trim: true, minlength: 4, maxlength: 150 },
  status: { type: String, enum: SUPPORT_STATUSES, default: 'Open', index: true },
  priority: { type: String, enum: SUPPORT_PRIORITIES, default: 'Normal', index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  history: { type: [historySchema], default: [] }
}, { timestamps: true });

supportTicketSchema.index({ customer: 1, updatedAt: -1 });
supportTicketSchema.index({ status: 1, priority: 1, updatedAt: -1 });
supportTicketSchema.index({ assignedTo: 1, updatedAt: -1 });
supportTicketSchema.index({ subject: 'text' });

export default mongoose.model('SupportTicket', supportTicketSchema);
