import mongoose from 'mongoose';
import PromoCode from '../models/PromoCode.js';
import PromoRedemption from '../models/PromoRedemption.js';
import { escapeRegex } from '../utils/safeQuery.js';
import { redeemPromoCode, cancelActivePromoCode, getActiveDiscount, PromoError } from '../utils/promoCode.js';

// ── Admin ──────────────────────────────────────────────────────────────────

export const listPromoCodes = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', type = '', status = '' } = req.query;
    const pg = Math.min(10000, Math.max(1, parseInt(page) || 1));
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 20));

    const query = {};
    if (type) query.type = type;
    if (status) query.status = status;
    if (search) {
      const safe = escapeRegex(String(search).slice(0, 100));
      query.$or = [{ name: { $regex: safe, $options: 'i' } }, { code: { $regex: safe, $options: 'i' } }];
    }

    const [items, total] = await Promise.all([
      PromoCode.find(query)
        .populate('allowedCustomerIds', 'username uid')
        .sort({ createdAt: -1 })
        .skip((pg - 1) * lim)
        .limit(lim)
        .lean(),
      PromoCode.countDocuments(query)
    ]);

    return res.json({ items, total, pages: Math.ceil(total / lim), currentPage: pg });
  } catch (error) {
    console.error('[PromoCode] listPromoCodes error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getPromoCode = async (req, res) => {
  try {
    const promo = await PromoCode.findById(req.params.id).populate('allowedCustomerIds', 'username uid');
    if (!promo) return res.status(404).json({ message: 'Промокод не найден' });
    return res.json(promo);
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
};

const ALLOWED_FIELDS = [
  'name', 'code', 'type', 'scope', 'discountType', 'amount', 'maxDiscountAmount',
  'audience', 'allowedCustomerIds', 'activationMode', 'usageLimit', 'startsAt', 'expiresAt'
];

function sanitizeBody(body) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (body[key] === undefined) continue;
    out[key] = body[key];
  }
  if (out.code) out.code = String(out.code).trim().toUpperCase();
  if (out.allowedCustomerIds) {
    out.allowedCustomerIds = (Array.isArray(out.allowedCustomerIds) ? out.allowedCustomerIds : [])
      .filter((id) => mongoose.isValidObjectId(id));
  }
  if (out.usageLimit === '' || out.usageLimit === null) out.usageLimit = null;
  if (out.maxDiscountAmount === '' || out.maxDiscountAmount === null) out.maxDiscountAmount = null;
  return out;
}

function validatePromoInput(data, { isUpdate = false } = {}) {
  if (!isUpdate || data.name !== undefined) {
    if (!data.name || !String(data.name).trim()) return 'Укажите название промокода';
  }
  if (!isUpdate || data.code !== undefined) {
    if (!data.code || !/^[A-Z0-9_-]{3,40}$/.test(data.code)) {
      return 'Код должен быть 3-40 символов: латиница, цифры, - или _';
    }
  }
  if (!isUpdate || data.type !== undefined) {
    if (!['balance', 'discount'].includes(data.type)) return 'Некорректный тип промокода';
  }
  if (data.type === 'discount') {
    if (data.scope && !['any', 'google_ads', 'youtube', 'service'].includes(data.scope)) return 'Некорректная область действия';
    if (data.discountType === 'percent' && data.amount > 100) return 'Процент скидки не может быть больше 100';
  }
  if (data.amount !== undefined && (!(data.amount > 0))) return 'Сумма промокода должна быть больше 0';
  if (data.audience === 'specific' && data.allowedCustomerIds !== undefined && !data.allowedCustomerIds.length) {
    return 'Выберите хотя бы одного пользователя для адресного промокода';
  }
  if (!isUpdate || data.expiresAt !== undefined) {
    if (!data.expiresAt || Number.isNaN(new Date(data.expiresAt).getTime())) return 'Укажите срок действия промокода';
  }
  return null;
}

export const createPromoCode = async (req, res) => {
  try {
    const data = sanitizeBody(req.body);
    const err = validatePromoInput(data);
    if (err) return res.status(400).json({ message: err });

    const existing = await PromoCode.findOne({ code: data.code });
    if (existing) return res.status(409).json({ message: 'Такой промокод уже существует' });

    const promo = await PromoCode.create({ ...data, createdBy: req.user?._id || null });
    return res.status(201).json(promo);
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'Такой промокод уже существует' });
    console.error('[PromoCode] createPromoCode error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updatePromoCode = async (req, res) => {
  try {
    const data = sanitizeBody(req.body);
    const err = validatePromoInput(data, { isUpdate: true });
    if (err) return res.status(400).json({ message: err });

    if (data.code) {
      const conflict = await PromoCode.findOne({ code: data.code, _id: { $ne: req.params.id } });
      if (conflict) return res.status(409).json({ message: 'Такой промокод уже существует' });
    }

    const promo = await PromoCode.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!promo) return res.status(404).json({ message: 'Промокод не найден' });
    return res.json(promo);
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'Такой промокод уже существует' });
    console.error('[PromoCode] updatePromoCode error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const setPromoCodeStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'disabled'].includes(status)) return res.status(400).json({ message: 'Некорректный статус' });
    const promo = await PromoCode.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!promo) return res.status(404).json({ message: 'Промокод не найден' });
    return res.json(promo);
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const deletePromoCode = async (req, res) => {
  try {
    const promo = await PromoCode.findById(req.params.id);
    if (!promo) return res.status(404).json({ message: 'Промокод не найден' });
    if (promo.usedCount > 0) {
      return res.status(400).json({ message: 'Нельзя удалить промокод, у которого уже есть активации. Отключите его вместо этого.' });
    }
    await promo.deleteOne();
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getPromoCodeRedemptions = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pg = Math.min(10000, Math.max(1, parseInt(page) || 1));
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 20));

    const query = { promoCodeId: req.params.id };
    const [items, total] = await Promise.all([
      PromoRedemption.find(query)
        .populate('customerId', 'username uid email')
        .sort({ createdAt: -1 })
        .skip((pg - 1) * lim)
        .limit(lim)
        .lean(),
      PromoRedemption.countDocuments(query)
    ]);

    return res.json({ items, total, pages: Math.ceil(total / lim), currentPage: pg });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── Customer ───────────────────────────────────────────────────────────────

export const getMyPromoCodes = async (req, res) => {
  try {
    const customerId = req.customer._id;
    const active = await getActiveDiscount(customerId);

    const history = await PromoRedemption.find({ customerId, status: { $ne: 'active' } })
      .populate('promoCodeId', 'name code type scope discountType amount')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({
      active: active ? {
        redemptionId: active.redemption._id,
        claimedAt: active.redemption.claimedAt,
        promo: {
          _id: active.promoCode._id,
          name: active.promoCode.name,
          code: active.promoCode.code,
          type: active.promoCode.type,
          scope: active.promoCode.scope,
          discountType: active.promoCode.discountType,
          amount: active.promoCode.amount,
          expiresAt: active.promoCode.expiresAt
        }
      } : null,
      history: history.filter((h) => h.promoCodeId)
    });
  } catch (error) {
    console.error('[PromoCode] getMyPromoCodes error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const redeemPromoCodeHandler = async (req, res) => {
  try {
    const { code, source = 'manual', force = false } = req.body;
    const result = await redeemPromoCode({ customerId: req.customer._id, code, source, force: !!force });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof PromoError) {
      return res.status(error.status).json({ message: error.message, code: error.code, ...error.extra });
    }
    console.error('[PromoCode] redeemPromoCodeHandler error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const cancelActivePromoCodeHandler = async (req, res) => {
  try {
    await cancelActivePromoCode(req.customer._id);
    return res.json({ ok: true });
  } catch (error) {
    if (error instanceof PromoError) return res.status(error.status).json({ message: error.message, code: error.code });
    return res.status(500).json({ message: 'Server error' });
  }
};
