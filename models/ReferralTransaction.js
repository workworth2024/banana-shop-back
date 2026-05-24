import mongoose from 'mongoose';
import crypto from 'crypto';

const referralTransactionSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => crypto.randomBytes(6).toString('hex').toUpperCase()
  },
  referrerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true,
    index: true
  },
  referralId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true,
    index: true
  },
  orderType: {
    type: String,
    enum: ['order', 'preorder', 'service_order'],
    required: true
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  orderUid: { type: String, default: '' },
  orderAmount: { type: Number, required: true },
  rewardPercent: { type: Number, required: true },
  rewardAmount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['active', 'clawed_back'],
    default: 'active'
  },
  transactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null
  },
  clawbackTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null
  }
}, { timestamps: true });

referralTransactionSchema.index({ orderId: 1, orderType: 1 });

export default mongoose.model('ReferralTransaction', referralTransactionSchema);
