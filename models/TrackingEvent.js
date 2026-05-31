import mongoose from 'mongoose';

const deviceSchema = new mongoose.Schema({
  type: { type: String, enum: ['mobile', 'tablet', 'desktop', 'bot', 'unknown'], default: 'unknown' },
  os: { type: String, default: '' },
  browser: { type: String, default: '' }
}, { _id: false });

const trackingEventSchema = new mongoose.Schema({
  linkId: { type: mongoose.Schema.Types.ObjectId, ref: 'TrackingLink', required: true, index: true },
  linkCode: { type: String, index: true },
  type: {
    type: String,
    enum: ['click', 'registration', 'order', 'service', 'preorder'],
    required: true,
    index: true
  },
  visitorId: { type: String, default: '' },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerUser', default: null, index: true },
  amount: { type: Number, default: 0 },
  geo: { type: String, default: '', uppercase: true, index: true },
  device: { type: deviceSchema, default: () => ({}) },
  referrer: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

trackingEventSchema.index({ linkId: 1, type: 1, createdAt: -1 });
trackingEventSchema.index({ type: 1, createdAt: -1 });
trackingEventSchema.index({ createdAt: -1 });

export default mongoose.model('TrackingEvent', trackingEventSchema);
