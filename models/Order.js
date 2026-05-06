import mongoose from 'mongoose';
import crypto from 'crypto';

const orderSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => 'ORD-' + crypto.randomBytes(5).toString('hex').toUpperCase()
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'productType'
  },
  productType: {
    type: String,
    required: true,
    enum: ['GoogleAdsProduct', 'YoutubeProduct']
  },
  digitalItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DigitalItem',
    default: null
  },
  productSnapshot: {
    title: { type: String, default: '' },
    price: { type: Number, default: 0 },
    image: { type: String, default: '' }
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
  status: {
    type: String,
    enum: ['pending', 'paid', 'delivered', 'cancelled'],
    default: 'pending'
  },
  paidAt: {
    type: Date,
    default: null
  },
  deliveredAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ status: 1 });

export default mongoose.model('Order', orderSchema);
