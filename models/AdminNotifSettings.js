import mongoose from 'mongoose';

const adminNotifSettingsSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  enabled: {
    transaction_deposit: { type: Boolean, default: true },
    transaction_payment: { type: Boolean, default: true },
    user_registration: { type: Boolean, default: true },
    order_product: { type: Boolean, default: true },
    order_preorder: { type: Boolean, default: true },
    order_replacement: { type: Boolean, default: true },
    support_ticket: { type: Boolean, default: true }
  }
}, { timestamps: true });

export default mongoose.model('AdminNotifSettings', adminNotifSettingsSchema);
