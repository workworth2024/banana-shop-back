import mongoose from 'mongoose';

/**
 * Site Analyzer anti-abuse counters, one row per (kind, subject, UTC day):
 *   ip:<day>:<hmac(ip bucket)>   — free (daily-quota) scan attempts from one network, across all accounts
 *   fail:<day>:<customerId>      — failed scans whose credit was refunded
 * The unique `key` makes "increment if below the limit" atomic (utils/analyzerCredits.js); rows expire after 3 days.
 */
const analyzerUsageCounterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  used: { type: Number, default: 0, min: 0 },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 3 }
});

export default mongoose.model('AnalyzerUsageCounter', analyzerUsageCounterSchema);
