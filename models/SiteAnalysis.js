import mongoose from 'mongoose';
import crypto from 'crypto';

const siteAnalysisSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => 'SA-' + crypto.randomBytes(5).toString('hex').toUpperCase()
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true,
    index: true
  },
  url: { type: String, required: true, trim: true },
  vertical: { type: String, default: 'general' },
  geo: { type: String, default: 'US', uppercase: true, trim: true },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  creditSource: {
    type: String,
    enum: ['daily', 'bonus'],
    default: 'daily'
  },
  riskScore: { type: Number, default: null },
  riskLevel: { type: String, default: null }, // LOW | MEDIUM | HIGH | CRITICAL
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  error: { type: String, default: null }
}, { timestamps: true });

siteAnalysisSchema.index({ customerId: 1, createdAt: -1 });

export default mongoose.model('SiteAnalysis', siteAnalysisSchema);
