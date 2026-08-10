import mongoose from 'mongoose';
import crypto from 'crypto';

const telegramLoginTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    default: () => crypto.randomBytes(24).toString('hex')
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true
  },
  telegramId: {
    type: String,
    required: true
  },
  used: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    required: true
  }
}, { timestamps: true });

// One-time link — expires quickly either way, TTL index sweeps stale docs.
telegramLoginTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('TelegramLoginToken', telegramLoginTokenSchema);
