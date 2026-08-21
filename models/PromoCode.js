import mongoose from 'mongoose';

const promoCodeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    maxlength: 40
  },
  // 'balance' credits the customer's wallet directly on redemption.
  // 'discount' becomes the customer's single "active" promo, consumed on their
  // next matching purchase.
  type: {
    type: String,
    enum: ['balance', 'discount'],
    required: true
  },
  // Only meaningful for type === 'discount'.
  scope: {
    type: String,
    enum: ['any', 'google_ads', 'youtube', 'service'],
    default: 'any'
  },
  discountType: {
    type: String,
    enum: ['fixed', 'percent'],
    default: 'fixed'
  },
  // 'balance': dollar amount credited. 'discount' + fixed: dollar amount off.
  // 'discount' + percent: percentage off (0-100).
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  // Optional cap in dollars for percent-based discounts. Null = uncapped.
  maxDiscountAmount: {
    type: Number,
    default: null,
    min: 0
  },
  audience: {
    type: String,
    enum: ['all', 'specific'],
    default: 'all'
  },
  allowedCustomerIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser'
  }],
  // Informational only — every promo code can be redeemed either by typing it
  // into "Мои промокоды" or via its shareable /promo/<code> link, regardless of
  // this value. It just records how the admin intends to distribute it.
  activationMode: {
    type: String,
    enum: ['manual', 'link'],
    default: 'manual'
  },
  // Total number of customers allowed to redeem this code. Null = unlimited.
  usageLimit: {
    type: Number,
    default: null,
    min: 1
  },
  usedCount: {
    type: Number,
    default: 0,
    min: 0
  },
  startsAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'disabled'],
    default: 'active'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, { timestamps: true });

export default mongoose.model('PromoCode', promoCodeSchema);
