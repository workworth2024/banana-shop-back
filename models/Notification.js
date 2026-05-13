import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true
  },
  type: {
    type: String,
    enum: ['order_delivered', 'order_status', 'order_replaced', 'order_refunded', 'balance_updated', 'preorder_status', 'service_order_status', 'system'],
    default: 'system'
  },
  title: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  message: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  link: {
    type: String,
    default: null
  },
  isRead: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
