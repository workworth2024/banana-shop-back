import mongoose from 'mongoose';

const promoRedemptionSchema = new mongoose.Schema({
  promoCodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PromoCode',
    required: true,
    index: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true,
    index: true
  },
  // balance codes go straight to 'used' (credited immediately); discount codes
  // start 'active' and move to 'used' once consumed by a matching purchase,
  // 'cancelled' if the customer gives it up, or 'expired' if time runs out first.
  status: {
    type: String,
    enum: ['active', 'used', 'cancelled', 'expired'],
    default: 'active'
  },
  source: {
    type: String,
    enum: ['manual', 'link', 'register'],
    default: 'manual'
  },
  amountCredited: {
    type: Number,
    default: 0
  },
  discountApplied: {
    type: Number,
    default: 0
  },
  orderRef: {
    orderType: { type: String, enum: ['order', 'preorder', 'service_order', null], default: null },
    orderId: { type: mongoose.Schema.Types.ObjectId, default: null }
  },
  claimedAt: {
    type: Date,
    default: Date.now
  },
  consumedAt: {
    type: Date,
    default: null
  },
  cancelledAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

// A given customer may only ever claim a given code once, regardless of what
// happened to that claim afterwards (used/cancelled/expired) — prevents
// cancel-and-reclaim gaming.
promoRedemptionSchema.index({ promoCodeId: 1, customerId: 1 }, { unique: true });

export default mongoose.model('PromoRedemption', promoRedemptionSchema);
