import mongoose from 'mongoose';
import crypto from 'crypto';

const supportTicketSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => 'TKT-' + crypto.randomBytes(4).toString('hex').toUpperCase()
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true,
    index: true
  },
  subject: {
    type: String,
    trim: true,
    maxlength: 200,
    default: 'Support request'
  },
  status: {
    type: String,
    enum: ['open', 'pending', 'closed'],
    default: 'open',
    index: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  lastMessageAt: {
    type: Date,
    default: () => new Date(),
    index: true
  },
  lastMessagePreview: {
    type: String,
    default: '',
    maxlength: 200
  },
  lastMessageBy: {
    type: String,
    enum: ['customer', 'staff', 'system', null],
    default: null
  },
  unreadByCustomer: { type: Number, default: 0 },
  unreadByStaff: { type: Number, default: 0 },
  closedAt: { type: Date, default: null },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

supportTicketSchema.index({ customerId: 1, status: 1, lastMessageAt: -1 });
supportTicketSchema.index({ status: 1, lastMessageAt: -1 });

export default mongoose.model('SupportTicket', supportTicketSchema);
