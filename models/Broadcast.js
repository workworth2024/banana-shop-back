import mongoose from 'mongoose';
import crypto from 'crypto';

const broadcastSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => 'BC-' + crypto.randomBytes(4).toString('hex').toUpperCase()
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 150
  },
  launchType: {
    type: String,
    enum: ['now', 'scheduled'],
    default: 'now'
  },
  // Always stored as the real UTC instant — the CRM converts the admin's
  // "MSK date/time" input to UTC before sending it here, and converts back
  // to MSK for display. See utils/broadcastEngine.js scheduler.
  scheduledAt: {
    type: Date,
    default: null
  },
  audienceType: {
    type: String,
    enum: ['customers', 'segment'],
    required: true
  },
  customerIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser'
  }],
  segmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Segment',
    default: null
  },
  deliverToSite: {
    type: Boolean,
    default: true
  },
  deliverToBot: {
    type: Boolean,
    default: true
  },
  text: {
    type: String,
    required: true,
    maxlength: 4000
  },
  imageUrl: {
    type: String,
    default: null
  },
  // Optional CTA — a named button with a link. Site: rendered in the popup
  // and as the notification's "link" action. Bot: sent as an inline keyboard
  // button attached to the message/photo.
  buttonText: {
    type: String,
    default: null,
    trim: true,
    maxlength: 60
  },
  buttonUrl: {
    type: String,
    default: null,
    trim: true
  },
  status: {
    type: String,
    enum: ['scheduled', 'sending', 'sent', 'failed', 'cancelled'],
    default: 'scheduled'
  },
  recipientCount: { type: Number, default: 0 },
  siteSentCount: { type: Number, default: 0 },
  botSentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  sentAt: { type: Date, default: null },
  error: { type: String, default: null },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, { timestamps: true });

broadcastSchema.index({ status: 1, scheduledAt: 1 });

export default mongoose.model('Broadcast', broadcastSchema);
