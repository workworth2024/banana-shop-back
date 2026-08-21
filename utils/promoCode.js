import PromoCode from '../models/PromoCode.js';
import PromoRedemption from '../models/PromoRedemption.js';
import CustomerUser from '../models/CustomerUser.js';
import { notifyCustomer } from './notify.js';

export class PromoError extends Error {
  constructor(message, code = 'PROMO_ERROR', status = 400, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function promoSummary(promoCode) {
  return {
    _id: promoCode._id,
    name: promoCode.name,
    code: promoCode.code,
    type: promoCode.type,
    scope: promoCode.scope,
    discountType: promoCode.discountType,
    amount: promoCode.amount,
    maxDiscountAmount: promoCode.maxDiscountAmount,
    expiresAt: promoCode.expiresAt
  };
}

/** Validates a code against a customer without claiming it — throws PromoError on any failure. */
async function findRedeemablePromoCode(code, customerId) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) throw new PromoError('Введите промокод', 'INVALID_CODE');

  const promoCode = await PromoCode.findOne({ code: clean });
  if (!promoCode) throw new PromoError('Промокод не найден', 'NOT_FOUND', 404);

  if (promoCode.status !== 'active') throw new PromoError('Промокод больше не активен', 'DISABLED');

  const now = new Date();
  if (promoCode.startsAt && promoCode.startsAt > now) throw new PromoError('Промокод ещё не начал действовать', 'NOT_STARTED');
  if (promoCode.expiresAt && promoCode.expiresAt < now) throw new PromoError('Срок действия промокода истёк', 'EXPIRED');

  if (promoCode.audience === 'specific') {
    const allowed = (promoCode.allowedCustomerIds || []).some((id) => String(id) === String(customerId));
    if (!allowed) throw new PromoError('Этот промокод для вас недоступен', 'NOT_ALLOWED', 403);
  }

  if (promoCode.usageLimit != null && promoCode.usedCount >= promoCode.usageLimit) {
    throw new PromoError('Лимит активаций промокода исчерпан', 'LIMIT_REACHED');
  }

  const existing = await PromoRedemption.findOne({ promoCodeId: promoCode._id, customerId });
  if (existing) throw new PromoError('Вы уже активировали этот промокод ранее', 'ALREADY_CLAIMED', 409);

  return promoCode;
}

/**
 * Redeems a promo code for a customer.
 * - `balance` codes credit the wallet immediately and return { status: 'credited' }.
 * - `discount` codes become the customer's active promo and return { status: 'active' }.
 *   If the customer already has an active discount promo, throws ALREADY_ACTIVE unless
 *   `force` is true (in which case the old one is silently cancelled first).
 */
export async function redeemPromoCode({ customerId, code, source = 'manual', force = false }) {
  const promoCode = await findRedeemablePromoCode(code, customerId);
  const customer = await CustomerUser.findById(customerId);
  if (!customer) throw new PromoError('Пользователь не найден', 'NOT_FOUND', 404);

  if (promoCode.type === 'discount') {
    if (customer.activePromoRedemptionId) {
      const current = await PromoRedemption.findOne({ _id: customer.activePromoRedemptionId, status: 'active' }).populate('promoCodeId');
      if (current && current.promoCodeId) {
        if (!force) {
          throw new PromoError('У вас уже есть активный промокод', 'ALREADY_ACTIVE', 409, { current: promoSummary(current.promoCodeId) });
        }
        current.status = 'cancelled';
        current.cancelledAt = new Date();
        await current.save();
      }
      customer.activePromoRedemptionId = null;
    }

    let redemption;
    try {
      redemption = await PromoRedemption.create({
        promoCodeId: promoCode._id,
        customerId,
        status: 'active',
        source
      });
    } catch (e) {
      if (e?.code === 11000) throw new PromoError('Вы уже активировали этот промокод ранее', 'ALREADY_CLAIMED', 409);
      throw e;
    }

    customer.activePromoRedemptionId = redemption._id;
    await customer.save();
    await PromoCode.updateOne({ _id: promoCode._id }, { $inc: { usedCount: 1 } });

    notifyCustomer({
      customerId,
      customer,
      type: 'promo_code',
      title: { ru: 'Промокод активирован', en: 'Promo code activated' },
      message: {
        ru: `Промокод «${promoCode.code}» активирован и применится к следующей подходящей покупке.`,
        en: `Promo code "${promoCode.code}" is now active and will apply to your next matching purchase.`
      },
      link: '/profile/promo-codes'
    }).catch(() => {});

    return { status: 'active', promo: promoSummary(promoCode) };
  }

  // type === 'balance': credit immediately, no "active" state to hold.
  let redemption;
  try {
    redemption = await PromoRedemption.create({
      promoCodeId: promoCode._id,
      customerId,
      status: 'used',
      source,
      amountCredited: promoCode.amount,
      consumedAt: new Date()
    });
  } catch (e) {
    if (e?.code === 11000) throw new PromoError('Вы уже активировали этот промокод ранее', 'ALREADY_CLAIMED', 409);
    throw e;
  }

  const updatedCustomer = await CustomerUser.findByIdAndUpdate(
    customerId,
    { $inc: { balance: promoCode.amount } },
    { returnDocument: 'after' }
  );

  await PromoCode.updateOne({ _id: promoCode._id }, { $inc: { usedCount: 1 } });

  const Transaction = (await import('../models/Transaction.js')).default;
  await Transaction.create({
    userId: customerId,
    type: 'promo_code',
    status: 'success',
    amount: promoCode.amount,
    currency: 'USD',
    note: `Промокод ${promoCode.code}`
  });

  try {
    const { io } = await import('../server.js');
    io.of('/customer').to(`customer:${String(customerId)}`).emit('balance_updated', {
      balance: updatedCustomer.balance,
      bonusBalance: updatedCustomer.bonusBalance
    });
  } catch {}

  notifyCustomer({
    customerId,
    customer: updatedCustomer,
    type: 'promo_code',
    title: { ru: 'Промокод активирован', en: 'Promo code activated' },
    message: {
      ru: `На баланс зачислено $${promoCode.amount.toFixed(2)} по промокоду «${promoCode.code}».`,
      en: `$${promoCode.amount.toFixed(2)} was credited to your balance via promo code "${promoCode.code}".`
    },
    link: '/profile/wallet'
  }).catch(() => {});

  return { status: 'credited', amount: promoCode.amount, balance: updatedCustomer.balance, redemptionId: redemption._id };
}

export async function cancelActivePromoCode(customerId) {
  const customer = await CustomerUser.findById(customerId);
  if (!customer?.activePromoRedemptionId) throw new PromoError('Нет активного промокода', 'NOT_FOUND', 404);

  await PromoRedemption.updateOne(
    { _id: customer.activePromoRedemptionId, status: 'active' },
    { $set: { status: 'cancelled', cancelledAt: new Date() } }
  );
  customer.activePromoRedemptionId = null;
  await customer.save();
  return { ok: true };
}

/**
 * Loads the customer's active discount redemption (if any and still valid),
 * lazily expiring it if its promo code's expiresAt has passed.
 */
export async function getActiveDiscount(customerId) {
  const customer = await CustomerUser.findById(customerId).select('activePromoRedemptionId');
  if (!customer?.activePromoRedemptionId) return null;

  const redemption = await PromoRedemption.findOne({ _id: customer.activePromoRedemptionId, status: 'active' }).populate('promoCodeId');
  if (!redemption || !redemption.promoCodeId) {
    await CustomerUser.updateOne({ _id: customerId }, { $set: { activePromoRedemptionId: null } });
    return null;
  }

  const promoCode = redemption.promoCodeId;
  if (promoCode.status !== 'active' || (promoCode.expiresAt && promoCode.expiresAt < new Date())) {
    redemption.status = 'expired';
    await redemption.save();
    await CustomerUser.updateOne({ _id: customerId }, { $set: { activePromoRedemptionId: null } });
    return null;
  }

  return { redemption, promoCode };
}

export function scopeMatches(promoCode, purchaseScope) {
  return promoCode.scope === 'any' || promoCode.scope === purchaseScope;
}

export function computeDiscountAmount(promoCode, baseAmount) {
  if (baseAmount <= 0) return 0;
  let discount = promoCode.discountType === 'percent'
    ? baseAmount * (promoCode.amount / 100)
    : promoCode.amount;
  if (promoCode.discountType === 'percent' && promoCode.maxDiscountAmount != null) {
    discount = Math.min(discount, promoCode.maxDiscountAmount);
  }
  return round2(Math.max(0, Math.min(discount, baseAmount)));
}

/**
 * Call after successfully creating an order/preorder/service order that used a
 * discount — marks the redemption consumed and frees the customer's active slot.
 */
export async function consumeActiveDiscount({ customerId, redemption, promoCode, discountApplied, orderType, orderId }) {
  redemption.status = 'used';
  redemption.discountApplied = discountApplied;
  redemption.consumedAt = new Date();
  redemption.orderRef = { orderType, orderId };
  await redemption.save();

  await CustomerUser.updateOne({ _id: customerId }, { $set: { activePromoRedemptionId: null } });

  notifyCustomer({
    customerId,
    type: 'promo_code',
    title: { ru: 'Скидка по промокоду применена', en: 'Promo code discount applied' },
    message: {
      ru: `По промокоду «${promoCode.code}» применена скидка $${discountApplied.toFixed(2)}.`,
      en: `Promo code "${promoCode.code}" gave you a $${discountApplied.toFixed(2)} discount.`
    },
    link: '/profile/promo-codes'
  }).catch(() => {});
}

/**
 * Convenience wrapper for the 3 checkout paths: given a customer + baseAmount +
 * purchase scope, returns either null (nothing to apply) or the discount info to
 * apply now, plus a `consume` callback to call once the order is actually created.
 */
export async function tryApplyDiscount(customerId, purchaseScope, baseAmount) {
  const active = await getActiveDiscount(customerId);
  if (!active) return null;
  const { redemption, promoCode } = active;
  if (!scopeMatches(promoCode, purchaseScope)) return null;

  const discountAmount = computeDiscountAmount(promoCode, baseAmount);
  if (discountAmount <= 0) return null;

  return {
    discountAmount,
    promoCode,
    consume: (orderType, orderId) => consumeActiveDiscount({ customerId, redemption, promoCode, discountApplied: discountAmount, orderType, orderId })
  };
}
