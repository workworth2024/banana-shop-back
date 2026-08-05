import mongoose from 'mongoose';
import crypto from 'crypto';

const customerUserSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => crypto.randomBytes(4).toString('hex').toUpperCase()
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  verifemail: {
    type: Boolean,
    default: true
  },
  pendingEmail: {
    type: String,
    default: null,
    trim: true,
    lowercase: true
  },
  emailCodeHash: {
    type: String,
    default: null
  },
  emailCodeExpires: {
    type: Date,
    default: null
  },
  emailCodeAttempts: {
    type: Number,
    default: 0
  },
  resetCodeHash: {
    type: String,
    default: null
  },
  resetCodeExpires: {
    type: Date,
    default: null
  },
  resetCodeAttempts: {
    type: Number,
    default: 0
  },
  twoFASecret: {
    type: String,
    default: null
  },
  twoFAEnabled: {
    type: Boolean,
    default: false
  },
  telegramId: {
    type: String
  },
  telegramUsername: {
    type: String,
    trim: true
  },
  telegramPhotoUrl: {
    type: String,
    default: null,
    trim: true
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  bonusBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  referralCode: {
    type: String,
    unique: true,
    default: () => crypto.randomBytes(5).toString('hex').toUpperCase()
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    default: null
  },
  status: {
    type: Boolean,
    default: true
  },
  lastSeen: {
    type: Date,
    default: null
  },
  acquisition: {
    linkId: { type: mongoose.Schema.Types.ObjectId, ref: 'TrackingLink', default: null },
    linkCode: { type: String, default: null },
    utm: {
      source: { type: String, default: '' },
      medium: { type: String, default: '' },
      campaign: { type: String, default: '' },
      term: { type: String, default: '' },
      content: { type: String, default: '' }
    },
    subs: { type: mongoose.Schema.Types.Mixed, default: {} },
    geo: { type: String, default: '' },
    device: {
      type: { type: String, default: 'unknown' },
      os: { type: String, default: '' },
      browser: { type: String, default: '' }
    },
    landedAt: { type: Date, default: null }
  },
  language: {
    type: String,
    enum: ['ru', 'en'],
    default: 'en'
  },
  analyzer: {
    dailyUsed: { type: Number, default: 0, min: 0 },
    dailyDate: { type: String, default: null }, // YYYY-MM-DD, resets dailyUsed when it changes
    bonusCredits: { type: Number, default: 0, min: 0 } // permanent, earned per purchased unit
  }
}, { timestamps: true });

customerUserSchema.index({ telegramId: 1 }, { unique: true, sparse: true });

export default mongoose.model('CustomerUser', customerUserSchema);
