import mongoose from 'mongoose';
import crypto from 'crypto';

const cryptoCloudInvoiceSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
    default: () => 'CC-' + crypto.randomBytes(6).toString('hex').toUpperCase()
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true,
    index: true
  },
  uuid: {
    type: String,
    default: '',
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  payLink: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['created', 'paid', 'partial', 'overpaid', 'canceled', 'failed'],
    default: 'created',
    index: true
  },
  amountPaidUsd: {
    type: Number,
    default: 0
  },
  transactionUid: {
    type: String,
    default: ''
  },
  rawResponse: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  rawPostback: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  paidAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

export default mongoose.model('CryptoCloudInvoice', cryptoCloudInvoiceSchema);
