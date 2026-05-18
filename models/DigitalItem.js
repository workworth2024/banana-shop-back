import mongoose from 'mongoose';
import crypto from 'crypto';

const digitalItemSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => crypto.randomBytes(6).toString('hex').toUpperCase()
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
  geo: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  filePath: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['available', 'sold', 'replaced', 'replacement_issued'],
    default: 'available'
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null
  }
}, { timestamps: true });

digitalItemSchema.index({ productId: 1, status: 1 });
digitalItemSchema.index({ productId: 1, geo: 1, status: 1 });

export default mongoose.model('DigitalItem', digitalItemSchema);
