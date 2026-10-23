import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * PPC Helper build (Keyword Engine v2): one offer → semantic core, metrics, negatives, SERP, AI drafts.
 * `result` holds the full internal BuildResult (incl. provider cost counters) and is never sent to the
 * browser as is — services/ppcHelper/index.js builds the public DTO. Long steps run in the background:
 * `status` covers the initial build, `busy` the follow-up job currently running (one at a time per build).
 */
const ppcBuildSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => 'PPC-' + crypto.randomBytes(6).toString('hex').toUpperCase()
  },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerUser', required: true },
  status: { type: String, enum: ['running', 'ready', 'failed'], default: 'running' },
  stage: { type: String, default: 'audit' }, // audit | keywords | metrics | done
  error: { type: String, default: null }, // neutral, user-facing
  errorInternal: { type: String, default: null }, // logs/admin only
  creditDay: { type: String, default: null },
  title: { type: String, required: true, trim: true },
  vertical: { type: String, required: true },
  geo: { type: String, required: true, uppercase: true },
  language: { type: String, required: true },
  landingUrl: { type: String, default: '' },
  keywordCount: { type: Number, default: 0 },
  metricsMatched: { type: Number, default: 0 },
  busy: { type: String, default: null }, // metrics | serp | expand | ads
  busyAt: { type: Date, default: null },
  usage: {
    metrics: { type: Number, default: 0 },
    serp: { type: Number, default: 0 },
    expand: { type: Number, default: 0 },
    ads: { type: Number, default: 0 }
  },
  // every start, including refunded ones — a refund returns the run, not the money already spent on providers
  attempts: {
    metrics: { type: Number, default: 0 },
    serp: { type: Number, default: 0 },
    expand: { type: Number, default: 0 },
    ads: { type: Number, default: 0 }
  },
  jobs: { type: mongoose.Schema.Types.Mixed, default: {} }, // { [job]: { status, error, finishedAt } }
  result: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true, minimize: false });

ppcBuildSchema.index({ customerId: 1, createdAt: -1 });

export default mongoose.model('PpcBuild', ppcBuildSchema);
