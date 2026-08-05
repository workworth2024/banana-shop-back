import CustomerUser from '../models/CustomerUser.js';

export const ANALYZER_DAILY_LIMIT = 3;
export const ANALYZER_CREDITS_PER_UNIT = 3;

const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

/**
 * Grants permanent bonus analyzer credits for a purchase.
 * Called next to recordPurchase()/creditReferralReward() at every purchase-completion
 * site (balance and CryptoCloud paths for orders/preorders/service orders).
 * Fire-and-forget safe — never throws.
 */
export async function grantAnalyzerCredits({ customerId, qty = 1 }) {
  try {
    if (!customerId) return;
    const units = Math.max(1, Math.floor(Number(qty) || 1));
    const credits = units * ANALYZER_CREDITS_PER_UNIT;
    await CustomerUser.updateOne(
      { _id: customerId },
      { $inc: { 'analyzer.bonusCredits': credits } }
    );
  } catch (e) {
    console.error('[AnalyzerCredits] grantAnalyzerCredits error:', e.message);
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
    totalRemaining: dailyRemaining + bonusCredits
  };
}

/**
 * Atomically consumes one analyzer request: daily quota first, then bonus credits.
 * Returns { ok: true, source: 'daily'|'bonus' } or { ok: false }.
 */
export async function consumeAnalyzerCredit(customerId) {
  const today = todayStr();

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

  if (dailyConsumed) return { ok: true, source: 'daily' };

  const sameDayConsumed = await CustomerUser.findOneAndUpdate(
    {
      _id: customerId,
      'analyzer.dailyDate': today,
      'analyzer.dailyUsed': { $lt: ANALYZER_DAILY_LIMIT }
    },
    { $inc: { 'analyzer.dailyUsed': 1 } },
    { returnDocument: 'after' }
  ).catch(() => null);

  if (sameDayConsumed) return { ok: true, source: 'daily' };

  const bonusConsumed = await CustomerUser.findOneAndUpdate(
    { _id: customerId, 'analyzer.bonusCredits': { $gte: 1 } },
    { $inc: { 'analyzer.bonusCredits': -1 } },
    { returnDocument: 'after' }
  ).catch(() => null);

  if (bonusConsumed) return { ok: true, source: 'bonus' };

  return { ok: false };
}

/** Refunds a previously consumed credit (used when a scan fails before completion). */
export async function refundAnalyzerCredit(customerId, source) {
  try {
    if (source === 'bonus') {
      await CustomerUser.updateOne({ _id: customerId }, { $inc: { 'analyzer.bonusCredits': 1 } });
    } else {
      await CustomerUser.updateOne({ _id: customerId }, { $inc: { 'analyzer.dailyUsed': -1 } });
    }
  } catch (e) {
    console.error('[AnalyzerCredits] refundAnalyzerCredit error:', e.message);
  }
}
