import mongoose from 'mongoose';
import crypto from 'crypto';

const preorderSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => 'PRE-' + crypto.randomBytes(4).toString('hex').toUpperCase()
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    default: null
  },
  google_item_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GoogleAdsProduct',
    default: null
  },
  youtube_item_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'YoutubeProduct',
    default: null
  },
  productType: {
    type: String,
    enum: ['google', 'youtube'],
    default: 'google'
  },
  geo: { type: String, default: '', uppercase: true, trim: true },
  geoBreakdown: [{
    geo: { type: String, uppercase: true, trim: true },
    quantity: { type: Number, min: 1 }
  }],
  name: { type: String, required: true, trim: true },
  telegram: { type: String, required: true, trim: true },
  desired_quantity: { type: Number, required: true, min: 1 },
  comment: { type: String, default: '', trim: true },
  unitPriceSnapshot: { type: Number, default: 0 },
  amountPaid: { type: Number, default: 0 },
  currency: { type: String, default: 'USD' },
  paymentMethod: { type: String, default: '' },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid'],
    default: 'unpaid'
  },
  paymentTransactionUid: { type: String, default: '' },
  ccInvoiceId: { type: String, default: '' },
  payLink: { type: String, default: '' },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  files: [{
    path: String,
    originalName: String,
    size: Number
  }],
  refundedQuantity: {
    type: Number,
    default: 0
  },
  refundedAmount: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

preorderSchema.index({ customerId: 1, createdAt: -1 });

export default mongoose.model('Preorder', preorderSchema);
