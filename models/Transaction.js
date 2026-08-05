import mongoose from 'mongoose';
import crypto from 'crypto';

const transactionSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => crypto.randomBytes(6).toString('hex').toUpperCase()
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['deposit_cash', 'deposit_admin', 'withdraw_admin', 'order', 'preorder', 'service_order', 'white_page_order', 'referral_reward', 'referral_clawback', 'refund'],
    required: true
  },
  status: {
    type: String,
    enum: ['success', 'fail'],
    required: true,
    default: 'success'
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'USD'
  },
  note: {
    type: String,
    default: null
  }
}, { timestamps: true });

export default mongoose.model('Transaction', transactionSchema);
