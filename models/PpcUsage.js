import mongoose from 'mongoose';

/**
 * PPC Helper daily quota counter: one row per (customer, UTC day). The unique index makes
 * "consume if below the limit" atomic (see utils/ppcCredits.js); rows expire after 45 days.
 */
const ppcUsageSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerUser', required: true },
  day: { type: String, required: true }, // YYYY-MM-DD (UTC)
  used: { type: Number, default: 0, min: 0 },
  attempts: { type: Number, default: 0, min: 0 }, // starts incl. refunded failures
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 45 }
});

ppcUsageSchema.index({ customerId: 1, day: 1 }, { unique: true });

export default mongoose.model('PpcUsage', ppcUsageSchema);
