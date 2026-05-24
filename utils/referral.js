import CustomerUser from '../models/CustomerUser.js';
import Transaction from '../models/Transaction.js';
import ReferralTransaction from '../models/ReferralTransaction.js';
import ReferralSettings from '../models/ReferralSettings.js';
import Notification from '../models/Notification.js';
import { io } from '../server.js';

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

export async function creditReferralReward({ customerId, orderAmount, orderType, orderId, orderUid, productType }) {
  try {
    const referral = await CustomerUser.findById(customerId).select('referredBy username');
    if (!referral || !referral.referredBy) return;

    const existing = await ReferralTransaction.findOne({ orderId, orderType });
    if (existing) return;

    const settings = await getSettings();
    const percent = resolvePercent(settings, orderType, productType);
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
      const notif = await Notification.create({
        userId: referrer._id,
        type: 'referral_reward',
        title: { ru: 'Реферальное начисление', en: 'Referral reward' },
        message: {
          ru: `Начислено $${rewardAmount.toFixed(2)} за покупку реферала`,
          en: `You earned $${rewardAmount.toFixed(2)} from referral purchase`
        },
        link: '/profile/referral'
      });
      io.of('/customer').to(`customer:${referrer._id}`).emit('balance_updated', { balance: referrer.balance, bonusBalance: referrer.bonusBalance });
      io.of('/customer').to(`customer:${referrer._id}`).emit('notification', {
        id: notif._id, type: notif.type, title: notif.title, message: notif.message, link: notif.link, createdAt: notif.createdAt
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
