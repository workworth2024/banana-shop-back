import mongoose from 'mongoose';
import crypto from 'crypto';

const responseSchema = new mongoose.Schema({
  stepId: { type: mongoose.Schema.Types.ObjectId },
  label: { type: String, default: '' },
  value: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

const fileSchema = new mongoose.Schema({
  path: { type: String },
  originalName: { type: String },
  size: { type: Number },
  stepId: { type: mongoose.Schema.Types.ObjectId, default: null }
}, { _id: true });

const serviceOrderSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => 'SVO-' + crypto.randomBytes(4).toString('hex').toUpperCase()
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: true
  },
  scenarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Scenario',
    default: null
  },
  serviceSnapshot: {
    title: { type: String, default: '' },
    price: { type: Number, default: 0 }
  },
  amountPaid: { type: Number, default: 0 },
  currency: { type: String, default: 'USD' },
  paymentMethod: { type: String, default: '' },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'pending_payment', 'paid', 'cancelled'],
    default: 'unpaid'
  },
  paymentTransactionUid: { type: String, default: '' },
  responses: [responseSchema],
  customerFiles: [fileSchema],
  resultFiles: [fileSchema],
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  adminComment: { type: String, default: '' }
}, { timestamps: true });

serviceOrderSchema.index({ customerId: 1, createdAt: -1 });

export default mongoose.model('ServiceOrder', serviceOrderSchema);
