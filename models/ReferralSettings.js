import mongoose from 'mongoose';

const referralSettingsSchema = new mongoose.Schema({
  googleAds: { type: Number, default: 5, min: 0, max: 100 },
  youtube: { type: Number, default: 5, min: 0, max: 100 },
  services: { type: Number, default: 5, min: 0, max: 100 },
}, { timestamps: true });

export default mongoose.model('ReferralSettings', referralSettingsSchema);
