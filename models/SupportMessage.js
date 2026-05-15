import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema({
  url: { type: String, required: true },
  name: { type: String, default: '' },
  size: { type: Number, default: 0 },
  mime: { type: String, default: '' },
  kind: { type: String, enum: ['image', 'file'], default: 'file' }
}, { _id: false });

const supportMessageSchema = new mongoose.Schema({
  ticketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupportTicket',
    required: true,
    index: true
  },
  senderRole: {
    type: String,
    enum: ['customer', 'staff', 'system'],
    required: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  senderName: { type: String, default: '' },
  text: { type: String, default: '', maxlength: 4000 },
  attachments: { type: [attachmentSchema], default: [] },
  readByCustomerAt: { type: Date, default: null },
  readByStaffAt: { type: Date, default: null },
  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

supportMessageSchema.index({ ticketId: 1, createdAt: 1 });

export default mongoose.model('SupportMessage', supportMessageSchema);
