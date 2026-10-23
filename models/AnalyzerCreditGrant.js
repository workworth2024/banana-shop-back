import mongoose from 'mongoose';

/**
 * Ledger of bonus Site Analyzer scans granted for purchases — one row per purchase.
 * The unique (sourceType, sourceId) index is what makes granting idempotent: a repeated
 * payment postback, a second "delivered" click or a race between them can't grant twice.
 */
const analyzerCreditGrantSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerUser', required: true, index: true },
  sourceType: { type: String, enum: ['order', 'preorder', 'service_order'], required: true },
  sourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  units: { type: Number, default: 1 },
  credits: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['active', 'revoked'], default: 'active' },
  revokedAt: { type: Date, default: null },
  // credits actually taken back on revoke (the customer may already have spent some)
  revokedCredits: { type: Number, default: 0 },
  backfilled: { type: Boolean, default: false }
}, { timestamps: true });

analyzerCreditGrantSchema.index({ sourceType: 1, sourceId: 1 }, { unique: true });

export default mongoose.model('AnalyzerCreditGrant', analyzerCreditGrantSchema);
