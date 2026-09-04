import mongoose from 'mongoose';
import { onlineCustomers } from '../server.js';
import { escapeRegex } from './safeQuery.js';

// Source of truth for what a segment can filter on. `type` drives both the
// mongo query shape here and which inputs the CRM builder renders.
//   number  -> { field, operator: gt|gte|lt|lte|eq, value }
//   date    -> { field, value: from (ISO), valueTo: to (ISO) } — either may be omitted
//   boolean -> { field, value: true|false }
//   text    -> { field, value } — case-insensitive "contains"
//   select  -> { field, value } — exact match against one of `options`
export const SEGMENT_FIELDS = {
  registrationDate: { type: 'date', path: 'createdAt', label: 'Дата регистрации' },
  lastActivityDate: { type: 'date', path: 'lastSeen', label: 'Дата последней активности' },
  isOnline: { type: 'boolean', label: 'Онлайн сейчас' },
  hasSiteAccount: { type: 'boolean', path: 'hasSiteAccount', label: 'Есть аккаунт на сайте' },
  telegramUsername: { type: 'text', path: 'telegramUsername', label: 'Ник Telegram' },
  balance: { type: 'number', path: 'balance', label: 'Сумма на балансе' },
  depositsSum: { type: 'number', path: 'depositsSum', label: 'Сумма депозитов' },
  depositsCount: { type: 'number', path: 'depositsCount', label: 'Количество депозитов' },
  ordersCount: { type: 'number', path: 'ordersCount', label: 'Количество заказов' },
  servicesOrderedCount: { type: 'number', path: 'servicesOrderedCount', label: 'Количество заказанных услуг' },
  whitePagesOrderedCount: { type: 'number', path: 'whitePagesOrderedCount', label: 'Количество заказанных вайтов' },
  lastPurchaseDate: { type: 'date', path: 'lastPurchaseDate', label: 'Дата последней покупки' },
  lastServiceDate: { type: 'date', path: 'lastServiceDate', label: 'Дата последней услуги' },
  lastPreorderDate: { type: 'date', path: 'lastPreorderDate', label: 'Дата последнего предзаказа' },
  lastProductCategory: {
    type: 'select',
    path: 'lastProductCategory',
    label: 'Последний заказанный товар',
    options: [
      { value: 'google_ads', label: 'Google Ads' },
      { value: 'youtube', label: 'YouTube' }
    ]
  }
};

const NUMBER_OPERATORS = { gt: '$gt', gte: '$gte', lt: '$lt', lte: '$lte', eq: '$eq' };

// customerId/userId lookups against every collection a customer can show up
// in, computed once so every condition (and the final $project) can read off
// plain top-level fields instead of repeating $lookups per condition.
const LOOKUP_STAGES = [
  { $lookup: { from: 'orders', localField: '_id', foreignField: 'customerId', as: '_orders' } },
  { $lookup: { from: 'preorders', localField: '_id', foreignField: 'customerId', as: '_preorders' } },
  { $lookup: { from: 'serviceorders', localField: '_id', foreignField: 'customerId', as: '_serviceOrders' } },
  { $lookup: { from: 'whitepageorders', localField: '_id', foreignField: 'customerId', as: '_whitePages' } },
  {
    $lookup: {
      from: 'transactions',
      let: { cid: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ['$userId', '$$cid'] },
            type: { $in: ['deposit_cash', 'deposit_admin'] },
            status: 'success'
          }
        },
        { $project: { amount: 1 } }
      ],
      as: '_deposits'
    }
  }
];

const COMPUTE_STAGE = {
  $addFields: {
    ordersCount: { $size: '$_orders' },
    servicesOrderedCount: { $size: '$_serviceOrders' },
    whitePagesOrderedCount: { $size: '$_whitePages' },
    depositsCount: { $size: '$_deposits' },
    depositsSum: { $sum: '$_deposits.amount' },
    // Bot-only customers get an auto-generated tg{id}@banana.internal email
    // (see findOrCreateTelegramCustomer) — anything else means they actually
    // registered on the site with a real email.
    hasSiteAccount: {
      $not: [{ $regexMatch: { input: { $ifNull: ['$email', ''] }, regex: /@banana\.internal$/ } }]
    },
    lastPurchaseDate: {
      $let: {
        vars: {
          dates: {
            $concatArrays: [
              { $ifNull: ['$_orders.createdAt', []] },
              { $ifNull: ['$_preorders.createdAt', []] },
              { $ifNull: ['$_whitePages.createdAt', []] }
            ]
          }
        },
        in: { $cond: [{ $gt: [{ $size: '$$dates' }, 0] }, { $max: '$$dates' }, null] }
      }
    },
    lastServiceDate: {
      $cond: [{ $gt: [{ $size: '$_serviceOrders' }, 0] }, { $max: '$_serviceOrders.createdAt' }, null]
    },
    lastPreorderDate: {
      $cond: [{ $gt: [{ $size: '$_preorders' }, 0] }, { $max: '$_preorders.createdAt' }, null]
    },
    lastProductCategory: {
      $let: {
        vars: { maxDate: { $max: '$_orders.createdAt' } },
        in: {
          $let: {
            vars: {
              lastOrder: {
                $arrayElemAt: [
                  { $filter: { input: '$_orders', cond: { $eq: ['$$this.createdAt', '$$maxDate'] } } },
                  0
                ]
              }
            },
            in: {
              $switch: {
                branches: [
                  { case: { $eq: ['$$lastOrder.productType', 'GoogleAdsProduct'] }, then: 'google_ads' },
                  { case: { $eq: ['$$lastOrder.productType', 'YoutubeProduct'] }, then: 'youtube' }
                ],
                default: null
              }
            }
          }
        }
      }
    }
  }
};

const CLEANUP_STAGE = {
  $project: { _orders: 0, _preorders: 0, _serviceOrders: 0, _whitePages: 0, _deposits: 0, password: 0, twoFASecret: 0 }
};

function buildConditionMatch(condition, onlineObjectIds) {
  const { field, operator, value, valueTo } = condition || {};
  const def = SEGMENT_FIELDS[field];
  if (!def) return null;

  if (field === 'isOnline') {
    return { _id: value ? { $in: onlineObjectIds } : { $nin: onlineObjectIds } };
  }

  if (def.type === 'number') {
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    const mongoOp = NUMBER_OPERATORS[operator] || '$eq';
    return { [def.path]: { [mongoOp]: num } };
  }

  if (def.type === 'date') {
    const range = {};
    if (value) {
      const from = new Date(value);
      if (!Number.isNaN(from.getTime())) range.$gte = from;
    }
    if (valueTo) {
      const to = new Date(valueTo);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        range.$lte = to;
      }
    }
    if (!Object.keys(range).length) return null;
    return { [def.path]: range };
  }

  if (def.type === 'boolean') {
    return { [def.path]: !!value };
  }

  if (def.type === 'text') {
    const str = String(value ?? '').trim().slice(0, 100);
    if (!str) return null;
    return { [def.path]: { $regex: escapeRegex(str), $options: 'i' } };
  }

  if (def.type === 'select') {
    if (!def.options.some((o) => o.value === value)) return null;
    return { [def.path]: value };
  }

  return null;
}

// Validates+normalizes raw condition objects coming from the CRM before they
// ever touch the aggregation builder or get saved on a Segment doc.
export function sanitizeConditions(rawConditions) {
  if (!Array.isArray(rawConditions)) return [];
  return rawConditions
    .filter((c) => c && SEGMENT_FIELDS[c.field])
    .map((c) => ({
      field: c.field,
      operator: c.operator ? String(c.operator).slice(0, 10) : null,
      value: c.value === undefined ? null : c.value,
      valueTo: c.valueTo === undefined ? null : c.valueTo
    }))
    .slice(0, 25);
}

// Shared by the "how many people match" preview, segment create/update
// (to cache memberCount), and the "view members" list.
export function buildSegmentPipeline(conditions = []) {
  const onlineObjectIds = [...onlineCustomers]
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const matches = (conditions || [])
    .map((c) => buildConditionMatch(c, onlineObjectIds))
    .filter(Boolean);

  const pipeline = [...LOOKUP_STAGES, COMPUTE_STAGE, CLEANUP_STAGE];
  if (matches.length) pipeline.push({ $match: { $and: matches } });
  return pipeline;
}
