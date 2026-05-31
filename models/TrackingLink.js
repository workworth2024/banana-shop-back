import mongoose from 'mongoose';
import crypto from 'crypto';

const subParamSchema = new mongoose.Schema({
  key: { type: String, trim: true, maxlength: 60 },
  value: { type: String, trim: true, maxlength: 200 }
}, { _id: false });

const utmSchema = new mongoose.Schema({
  source: { type: String, trim: true, default: '', maxlength: 120 },
  medium: { type: String, trim: true, default: '', maxlength: 120 },
  campaign: { type: String, trim: true, default: '', maxlength: 120 },
  term: { type: String, trim: true, default: '', maxlength: 120 },
  content: { type: String, trim: true, default: '', maxlength: 120 }
}, { _id: false });

const trackingLinkSchema = new mongoose.Schema({
  code: {
    type: String,
    unique: true,
    default: () => crypto.randomBytes(5).toString('hex')
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  targetPath: {
    type: String,
    trim: true,
    default: '/',
    maxlength: 300
  },
  utm: { type: utmSchema, default: () => ({}) },
  subs: { type: [subParamSchema], default: [] },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  stats: {
    clicks: { type: Number, default: 0 },
    uniqueVisitors: { type: Number, default: 0 },
    registrations: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 }
  }
}, { timestamps: true });

export default mongoose.model('TrackingLink', trackingLinkSchema);
