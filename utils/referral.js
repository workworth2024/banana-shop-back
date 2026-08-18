import CustomerUser from '../models/CustomerUser.js';
import Transaction from '../models/Transaction.js';
import ReferralTransaction from '../models/ReferralTransaction.js';
import ReferralSettings from '../models/ReferralSettings.js';
import CustomerReferralRate from '../models/CustomerReferralRate.js';
import { io } from '../server.js';
import { notifyCustomer } from './notify.js';

async function getSettings() {
  let settings = await ReferralSettings.findOne();
  if (!settings) settings = await ReferralSettings.create({});
  return settings;
}

function resolvePercent(settings, orderType, productType) {
  if (orderType === 'service_order') return settings.services;
  if (productType === 'YoutubeProduct') return settings.youtube;
  return settings.googleAds;
}

async function getEffectivePercent(referrerId, settings, orderType, productType) {
  const individual = await CustomerReferralRate.findOne({ customerId: referrerId }).lean();
  if (individual) {
    let rate = null;
    if (orderType === 'service_order') rate = individual.services;
    else if (productType === 'YoutubeProduct') rate = individual.youtube;
    else rate = individual.googleAds;
    if (rate !== null && rate !== undefined) return rate;
  }
  return resolvePercent(settings, orderType, productType);
}

export async function creditReferralReward({ customerId, orderAmount, orderType, orderId, orderUid, productType }) {
  try {
    const referral = await CustomerUser.findById(customerId).select('referredBy username');
    if (!referral || !referral.referredBy) return;

    const existing = await ReferralTransaction.findOne({ orderId, orderType });
    if (existing) return;

    const settings = await getSettings();
    const percent = await getEffectivePercent(referral.referredBy, settings, orderType, productType);
    if (!percent || percent <= 0) return;

    const rewardAmount = parseFloat(((orderAmount * percent) / 100).toFixed(4));
    if (rewardAmount <= 0) return;

    const referrer = await CustomerUser.findByIdAndUpdate(
      referral.referredBy,
      { $inc: { bonusBalance: rewardAmount } },
      { returnDocument: 'after' }
    );
    if (!referrer) return;

    const tx = await Transaction.create({
      userId: referrer._id,
      type: 'referral_reward',
      status: 'success',
      amount: rewardAmount,
      currency: 'USD',
      note: `Реферал ${referral.username || customerId}: ${orderType} ${orderUid || orderId}`
    });

    const refTx = await ReferralTransaction.create({
      referrerId: referrer._id,
      referralId: customerId,
      orderType,
      orderId,
      orderUid: orderUid || '',
      orderAmount,
      rewardPercent: percent,
      rewardAmount,
      status: 'active',
      transactionId: tx._id
    });

    try {
      io.of('/customer').to(`customer:${referrer._id}`).emit('balance_updated', { balance: referrer.balance, bonusBalance: referrer.bonusBalance });
      await notifyCustomer({
        customerId: referrer._id,
        customer: referrer,
        type: 'referral_reward',
        title: { ru: 'Реферальное начисление', en: 'Referral reward' },
        message: {
          ru: `Начислено $${rewardAmount.toFixed(2)} за покупку реферала`,
          en: `You earned $${rewardAmount.toFixed(2)} from referral purchase`
        },
        link: '/profile/referral'
      });
    } catch {}

    return refTx;
  } catch (e) {
    console.error('[Referral] creditReferralReward error:', e);
  }
}

export async function clawbackReferralReward({ orderId, orderType }) {
  try {
    const refTx = await ReferralTransaction.findOne({ orderId, orderType, status: 'active' });
    if (!refTx) return;

    const referrer = await CustomerUser.findById(refTx.referrerId);
    if (!referrer) return;

    const fromBonus = Math.min(referrer.bonusBalance || 0, refTx.rewardAmount);
    const fromMain = refTx.rewardAmount - fromBonus;
    const update = {};
    if (fromBonus > 0) update.bonusBalance = -fromBonus;
    if (fromMain > 0) update.balance = -fromMain;
    if (Object.keys(update).length) {
      await CustomerUser.findByIdAndUpdate(refTx.referrerId, { $inc: update });
    }
    const updated = await CustomerUser.findById(refTx.referrerId);

    const tx = await Transaction.create({
      userId: refTx.referrerId,
      type: 'referral_clawback',
      status: 'success',
      amount: -refTx.rewardAmount,
      currency: 'USD',
      note: `Возврат реф. начисления: ${orderType} ${refTx.orderUid || orderId}`
    });

    refTx.status = 'clawed_back';
    refTx.clawbackTransactionId = tx._id;
    await refTx.save();

    try {
      io.of('/customer').to(`customer:${refTx.referrerId}`).emit('balance_updated', {
        balance: updated?.balance ?? referrer.balance,
        bonusBalance: updated?.bonusBalance ?? referrer.bonusBalance
      });
    } catch {}
  } catch (e) {
    console.error('[Referral] clawbackReferralReward error:', e);
  }
}
