import crypto from 'crypto';
import { ipKeyGenerator } from 'express-rate-limit';
import CustomerUser from '../models/CustomerUser.js';
import AnalyzerCreditGrant from '../models/AnalyzerCreditGrant.js';
import AnalyzerUsageCounter from '../models/AnalyzerUsageCounter.js';

export const ANALYZER_DAILY_LIMIT = 3;

// Anti multi-accounting: free (daily-quota) scan attempts per network per UTC day, summed over every
// account that scans from it (IPv4 address / IPv6 /64). Purchased bonus scans are not limited by it.
export const ANALYZER_IP_DAILY_LIMIT = Math.max(1, Number(process.env.ANALYZER_IP_DAILY_LIMIT) || 10);
// Failed scans still burn paid APIs (fetch, PageSpeed, AI) — only this many per account per day get the credit back.
export const ANALYZER_FAILED_REFUNDS_PER_DAY = 3;

// The daily quota follows the UTC calendar day (00:00 UTC = 03:00 Moscow time).
const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const nextResetIso = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };

// Bonus scans are an overflow buffer on top of the free daily quota, not a second free tier:
// real usage is 1–2 scans a day (only a handful of user-days ever hit 3), and most orders are
// for 1 unit. So a purchase gives a flat +3 whatever its quantity, and the stored balance is
// capped — a regular buyer with 34 orders keeps at most 15 instead of piling up 100+.
export const ANALYZER_CREDITS_PER_ORDER = 3;
export const ANALYZER_BONUS_CAP = 15;

const isDuplicateKey = (e) => e?.code === 11000;
let ledgerReady = null;
const ensureLedger = () => (ledgerReady ||= AnalyzerCreditGrant.init().catch((e) => { ledgerReady = null; throw e; }));

/** Atomically adds up to `credits` without crossing the cap; returns how many were actually added. */
async function addCapped(customerId, credits) {
  const before = await CustomerUser.findOneAndUpdate(
    { _id: customerId },
    [{ $set: { 'analyzer.bonusCredits': { $let: {
      vars: { cur: { $ifNull: ['$analyzer.bonusCredits', 0] } },
      in: { $max: ['$$cur', { $min: [ANALYZER_BONUS_CAP, { $add: ['$$cur', credits] }] }] }
    } } } }],
    { returnDocument: 'before', projection: { 'analyzer.bonusCredits': 1 }, updatePipeline: true }
  );
  if (!before) return 0;
  const cur = before.analyzer?.bonusCredits || 0;
  return Math.max(0, Math.min(ANALYZER_BONUS_CAP, cur + credits) - cur);
}

/**
 * Grants bonus analyzer scans for a purchase — exactly once per (sourceType, sourceId), recorded in
 * the AnalyzerCreditGrant ledger. If this purchase's grant was revoked earlier (cancel → re-deliver),
 * it is restored instead. Fire-and-forget safe — never throws. Returns the number of scans added.
 */
export async function grantAnalyzerCredits({ customerId, qty = 1, sourceType, sourceId }) {
  try {
    if (!customerId) return 0;
    const units = Math.max(1, Math.floor(Number(qty) || 1));
    if (!sourceType || !sourceId) {
      console.warn('[AnalyzerCredits] grant without a source — not idempotent', { customerId: String(customerId) });
      return addCapped(customerId, ANALYZER_CREDITS_PER_ORDER);
    }
    await ensureLedger();
    let grant;
    try {
      grant = await AnalyzerCreditGrant.create({ customerId, sourceType, sourceId, units, credits: 0 });
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      return restoreAnalyzerCredits({ sourceType, sourceId });
    }
    const added = await addCapped(customerId, ANALYZER_CREDITS_PER_ORDER);
    await AnalyzerCreditGrant.updateOne({ _id: grant._id }, { $set: { credits: added } });
    return added;
  } catch (e) {
    console.error('[AnalyzerCredits] grantAnalyzerCredits error:', e.message);
    return 0;
  }
}

/** Re-activates a previously revoked grant (order un-cancelled). No-op if it is active or missing. */
export async function restoreAnalyzerCredits({ sourceType, sourceId }) {
  try {
    const g = await AnalyzerCreditGrant.findOneAndUpdate(
      { sourceType, sourceId, status: 'revoked' },
      { $set: { status: 'active', revokedAt: null, revokedCredits: 0 } }
    );
    if (!g || !g.revokedCredits) return 0;
    const added = await addCapped(g.customerId, g.revokedCredits);
    await AnalyzerCreditGrant.updateOne({ _id: g._id }, { $set: { credits: added } });
    return added;
  } catch (e) {
    console.error('[AnalyzerCredits] restoreAnalyzerCredits error:', e.message);
    return 0;
  }
}

/**
 * Takes the bonus scans of a cancelled / fully refunded / deleted purchase back — once.
 * Scans already spent are not charged: the balance never goes below 0.
 */
export async function revokeAnalyzerCredits({ sourceType, sourceId }) {
  try {
    const g = await AnalyzerCreditGrant.findOneAndUpdate(
      { sourceType, sourceId, status: 'active' },
      { $set: { status: 'revoked', revokedAt: new Date() } }
    );
    if (!g) return 0;
    const before = await CustomerUser.findOneAndUpdate(
      { _id: g.customerId },
      [{ $set: { 'analyzer.bonusCredits': { $max: [0, { $subtract: [{ $ifNull: ['$analyzer.bonusCredits', 0] }, g.credits] }] } } }],
      { returnDocument: 'before', projection: { 'analyzer.bonusCredits': 1 }, updatePipeline: true }
    );
    const taken = Math.min(g.credits, before?.analyzer?.bonusCredits || 0);
    await AnalyzerCreditGrant.updateOne({ _id: g._id }, { $set: { revokedCredits: taken } });
    return taken;
  } catch (e) {
    console.error('[AnalyzerCredits] revokeAnalyzerCredits error:', e.message);
    return 0;
  }
}

/**
 * Returns the customer's current analyzer quota (resets the daily counter if the
 * stored date is stale, but does not persist the reset — that happens on consume).
 */
export function getAnalyzerLimitsView(customer) {
  const a = customer.analyzer || {};
  const dailyUsed = a.dailyDate === todayStr() ? (a.dailyUsed || 0) : 0;
  const dailyRemaining = Math.max(0, ANALYZER_DAILY_LIMIT - dailyUsed);
  const bonusCredits = a.bonusCredits || 0;
  return {
    dailyLimit: ANALYZER_DAILY_LIMIT,
    dailyUsed,
    dailyRemaining,
    bonusCredits,
    totalRemaining: dailyRemaining + bonusCredits,
    resetsAt: nextResetIso()
  };
}

/**
 * Atomically consumes one analyzer request: daily quota first, then bonus credits.
 * Returns { ok: true, source: 'daily'|'bonus' } or { ok: false }.
 */
export async function consumeAnalyzerCredit(customerId, { bonusOnly = false } = {}) {
  const today = todayStr();
  if (bonusOnly) return consumeBonus(customerId);

  // Try daily quota first (handles day rollover atomically via $or on stale/missing date)
  const dailyConsumed = await CustomerUser.findOneAndUpdate(
    {
      _id: customerId,
      $or: [
        { 'analyzer.dailyDate': { $ne: today }, }, // stale day → reset path
      ]
    },
    { $set: { 'analyzer.dailyDate': today, 'analyzer.dailyUsed': 1 } },
    { returnDocument: 'after' }
  ).catch(() => null);

  if (dailyConsumed) return { ok: true, source: 'daily', day: today };

  const sameDayConsumed = await CustomerUser.findOneAndUpdate(
    {
      _id: customerId,
      'analyzer.dailyDate': today,
      'analyzer.dailyUsed': { $lt: ANALYZER_DAILY_LIMIT }
    },
    { $inc: { 'analyzer.dailyUsed': 1 } },
    { returnDocument: 'after' }
  ).catch(() => null);

  if (sameDayConsumed) return { ok: true, source: 'daily', day: today };

  return consumeBonus(customerId);
}

async function consumeBonus(customerId) {
  const bonusConsumed = await CustomerUser.findOneAndUpdate(
    { _id: customerId, 'analyzer.bonusCredits': { $gte: 1 } },
    { $inc: { 'analyzer.bonusCredits': -1 } },
    { returnDocument: 'after' }
  ).catch(() => null);

  return bonusConsumed ? { ok: true, source: 'bonus' } : { ok: false };
}

/** Atomically bumps a per-day counter if it is still below `limit`; true = slot taken. */
let countersReady = null;
async function takeCounterSlot(key, limit) {
  // the unique index must exist before the upsert relies on it
  await (countersReady ||= AnalyzerUsageCounter.init().catch((e) => { countersReady = null; throw e; }));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const doc = await AnalyzerUsageCounter.findOneAndUpdate(
        { key, used: { $lt: limit } },
        { $inc: { used: 1 } },
        { upsert: true, returnDocument: 'after' }
      );
      return !!doc;
    } catch (e) {
      // over the limit → the filter misses and the upsert hits the unique key; on a first-insert race, retry once
      if (!isDuplicateKey(e)) throw e;
    }
  }
  return false;
}

/** Network bucket of a client IP (IPv4 address, IPv6 /64), keyed with a server secret — raw IPs are not stored. */
export function analyzerIpBucket(ip) {
  const bucket = ipKeyGenerator(String(ip || 'unknown'), 64);
  return crypto.createHmac('sha256', process.env.JWT_SECRET || 'analyzer').update(bucket).digest('hex').slice(0, 32);
}

/** One free-scan attempt from this network today; false = the network's daily limit is used up. */
export const takeAnalyzerIpSlot = (ip, day = todayStr()) =>
  takeCounterSlot(`ip:${day}:${analyzerIpBucket(ip)}`, ANALYZER_IP_DAILY_LIMIT);

/** True while the customer still has failed-scan refunds left today (and records this one). */
export const takeFailedScanRefund = (customerId, day = todayStr()) =>
  takeCounterSlot(`fail:${day}:${customerId}`, ANALYZER_FAILED_REFUNDS_PER_DAY).catch(() => false);

/**
 * Refunds a previously consumed credit (used when a scan fails before completion).
 * A daily credit is returned only to the same UTC day it was taken from and never below 0 —
 * a scan that started at 23:59 and failed after midnight must not eat into tomorrow's quota.
 */
export async function refundAnalyzerCredit(customerId, source, day = todayStr()) {
  try {
    if (source === 'bonus') {
      await CustomerUser.updateOne({ _id: customerId }, { $inc: { 'analyzer.bonusCredits': 1 } });
    } else {
      await CustomerUser.updateOne(
        { _id: customerId, 'analyzer.dailyDate': day, 'analyzer.dailyUsed': { $gt: 0 } },
        { $inc: { 'analyzer.dailyUsed': -1 } }
      );
    }
  } catch (e) {
    console.error('[AnalyzerCredits] refundAnalyzerCredit error:', e.message);
  }
}
