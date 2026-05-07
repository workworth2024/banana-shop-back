import mongoose from 'mongoose';
import crypto from 'crypto';

const adminNotificationSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => crypto.randomBytes(5).toString('hex').toUpperCase()
  },
  category: {
    type: String,
    enum: ['transaction', 'user', 'order', 'preorder', 'replacement', 'support'],
    required: true
  },
  type: {
    type: String,
    required: true
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  link: { type: String, default: null },
  isRead: { type: Boolean, default: false },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

adminNotificationSchema.index({ category: 1, createdAt: -1 });
adminNotificationSchema.index({ isRead: 1, createdAt: -1 });

export default mongoose.model('AdminNotification', adminNotificationSchema);
