import mongoose from 'mongoose';

const replaceRequestSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true
  },
  reason: {
    type: String,
    required: true,
    maxlength: 2000
  },
  photos: [{
    type: String
  }],
  status: {
    type: String,
    enum: ['pending', 'resolved'],
    default: 'pending'
  }
}, { timestamps: true });

replaceRequestSchema.index({ customerId: 1 });

export default mongoose.model('ReplaceRequest', replaceRequestSchema);
