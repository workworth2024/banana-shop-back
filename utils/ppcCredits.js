import PpcUsage from '../models/PpcUsage.js';

export const PPC_DAILY_LIMIT = Math.max(1, Number(process.env.PPC_DAILY_LIMIT) || 1);
// failed builds are refunded, but each start still costs provider/CPU time — cap the starts per day too
export const ppcMaxAttempts = (limit) => limit + Math.max(3, limit);

// Same calendar as the Site Analyzer quota: the UTC day (00:00 UTC = 03:00 Moscow time).
const todayStr = () => new Date().toISOString().slice(0, 10);
const nextResetIso = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };

let indexesReady = null;
const ensureIndexes = () => (indexesReady ||= PpcUsage.init().catch((e) => { indexesReady = null; throw e; }));

export async function getPpcLimits(customerId, limit = PPC_DAILY_LIMIT) {
  const row = await PpcUsage.findOne({ customerId, day: todayStr() }).select('used attempts').lean();
  const dailyUsed = Math.min(limit, row?.used || 0);
  const attemptsLeft = Math.max(0, ppcMaxAttempts(limit) - (row?.attempts || 0));
  const dailyRemaining = attemptsLeft ? Math.max(0, limit - dailyUsed) : 0;
  return { dailyLimit: limit, dailyUsed, dailyRemaining, bonusCredits: 0, totalRemaining: dailyRemaining, attemptsBlocked: !attemptsLeft, resetsAt: nextResetIso() };
}

/**
 * Atomically takes one build from today's quota. The filter only matches while used < limit;
 * once the limit is reached the upsert collides with the unique index → quota exhausted.
 */
export async function consumePpcCredit(customerId, limit = PPC_DAILY_LIMIT) {
  await ensureIndexes();
  const day = todayStr();
  try {
    await PpcUsage.findOneAndUpdate(
      { customerId, day, used: { $lt: limit }, attempts: { $not: { $gte: ppcMaxAttempts(limit) } } },
      { $inc: { used: 1, attempts: 1 }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, returnDocument: 'after' }
    );
    return { ok: true, day };
  } catch (e) {
    if (e?.code === 11000) {
      const row = await PpcUsage.findOne({ customerId, day }).select('used attempts').lean();
      return { ok: false, reason: (row?.used || 0) < limit ? 'attempts' : 'quota' };
    }
    throw e;
  }
}

/** Returns a build to the day it was taken from (a failed build must not burn the quota). Never throws. */
export async function refundPpcCredit(customerId, day) {
  if (!day) return;
  try {
    await PpcUsage.updateOne({ customerId, day, used: { $gt: 0 } }, { $inc: { used: -1 } });
  } catch (e) {
    console.error('[PpcCredits] refund error:', e.message);
  }
}
