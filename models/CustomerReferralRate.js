import mongoose from 'mongoose';

const customerReferralRateSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true,
    unique: true
  },
  googleAds: { type: Number, default: null, min: 0, max: 100 },
  youtube: { type: Number, default: null, min: 0, max: 100 },
  services: { type: Number, default: null, min: 0, max: 100 },
}, { timestamps: true });

export default mongoose.model('CustomerReferralRate', customerReferralRateSchema);
