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
  balance: {
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
  language: {
    type: String,
    enum: ['ru', 'en'],
    default: 'en'
  }
}, { timestamps: true });

customerUserSchema.index({ telegramId: 1 }, { unique: true, sparse: true });

export default mongoose.model('CustomerUser', customerUserSchema);
