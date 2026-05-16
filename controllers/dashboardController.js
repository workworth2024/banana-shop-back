import mongoose from 'mongoose';
import CustomerUser from '../models/CustomerUser.js';
import Transaction from '../models/Transaction.js';
import Order from '../models/Order.js';
import ServiceOrder from '../models/ServiceOrder.js';
import Preorder from '../models/Preorder.js';
import SupportTicket from '../models/SupportTicket.js';
import Service from '../models/Service.js';
import YoutubeProduct from '../models/YoutubeProduct.js';
import GoogleAdsProduct from '../models/GoogleAdsProduct.js';
import { onlineCustomers } from '../server.js';

const attachProductUids = async (items) => {
  const ids = items.map((p) => p.id).filter(Boolean);
  if (!ids.length) return items;
  const [yt, gads] = await Promise.all([
    YoutubeProduct.find({ _id: { $in: ids } }).select('_id uid').lean(),
    GoogleAdsProduct.find({ _id: { $in: ids } }).select('_id uid').lean()
  ]);
  const map = new Map();
  for (const p of yt) map.set(String(p._id), { uid: p.uid, productType: 'YoutubeProduct' });
  for (const p of gads) map.set(String(p._id), { uid: p.uid, productType: 'GoogleAdsProduct' });
  return items.map((p) => {
    const info = map.get(String(p.id)) || {};
    return { ...p, uid: info.uid || '', productType: info.productType || p.productType || '' };
  });
};

const attachServiceUids = async (items) => {
  const ids = items.map((s) => s.id).filter(Boolean);
  if (!ids.length) return items;
  const services = await Service.find({ _id: { $in: ids } }).select('_id uid path_image').lean();
  const map = new Map(services.map((s) => [String(s._id), s]));
  return items.map((s) => {
    const info = map.get(String(s.id)) || {};
    return { ...s, uid: info.uid || '', image: s.image || info.path_image || '' };
  });
};

const DAY_MS = 24 * 60 * 60 * 1000;

const parseRange = (q) => {
  const now = new Date();
  let to = q.to ? new Date(q.to) : now;
  let from;
  if (q.from) {
    from = new Date(q.from);
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (Number.isNaN(from.getTime())) from = new Date(now.getFullYear(), now.getMonth(), 1);
  if (Number.isNaN(to.getTime())) to = now;
  if (to < from) [from, to] = [to, from];

  const span = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - span);
  return { from, to, prevFrom, prevTo, span };
};

const pickBucket = (span) => {
  if (span <= 2 * DAY_MS) return { unit: 'hour', fmt: '%Y-%m-%dT%H:00' };
  if (span <= 90 * DAY_MS) return { unit: 'day', fmt: '%Y-%m-%d' };
  return { unit: 'week', fmt: '%G-W%V' };
};

const fillSeries = (points, from, to, unit, keys) => {
  const map = new Map(points.map((p) => [p._id, p]));
  const out = [];
  const cur = new Date(from);
  const step = unit === 'hour' ? 60 * 60 * 1000 : unit === 'day' ? DAY_MS : 7 * DAY_MS;
  if (unit === 'hour') cur.setMinutes(0, 0, 0);
  else cur.setHours(0, 0, 0, 0);

  const fmt = (d) => {
    if (unit === 'hour') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:00`;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  let guard = 0;
  while (cur <= to && guard < 5000) {
    const key = unit === 'week' ? null : fmt(cur);
    if (key !== null) {
      const found = map.get(key) || {};
      const row = { t: cur.toISOString() };
      keys.forEach((k) => { row[k] = found[k] || 0; });
      out.push(row);
    }
    cur.setTime(cur.getTime() + step);
    guard++;
  }
  if (unit === 'week') {
    return points.map((p) => {
      const row = { t: p._id };
      keys.forEach((k) => { row[k] = p[k] || 0; });
      return row;
    });
  }
  return out;
};

const safeNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const TOP_LIMIT = 10;
const clampPage = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 1;
};

export const getDashboard = async (req, res) => {
  try {
    const { from, to, prevFrom, prevTo, span } = parseRange(req.query);
    const bucket = pickBucket(span);

    const periodMatch = { createdAt: { $gte: from, $lte: to } };
    const prevPeriodMatch = { createdAt: { $gte: prevFrom, $lte: prevTo } };

    const [
      newUsersCur,
      newUsersPrev,
      depositorsCur,
      depositorsPrev,
      depositSumCur,
      depositSumPrev,
      ordersAgg,
      ordersAggPrev,
      servicesAgg,
      servicesAggPrev,
      preordersAgg,
      preordersAggPrev,
      openTickets,
      revenueSeriesOrders,
      revenueSeriesServices,
      revenueSeriesPreorders,
      usersSeries,
      depositSeries,
      topProducts,
      topCustomers,
      topServices
    ] = await Promise.all([
      CustomerUser.countDocuments(periodMatch),
      CustomerUser.countDocuments(prevPeriodMatch),

      Transaction.aggregate([
        { $match: { ...periodMatch, status: 'success', type: { $in: ['deposit_cash'] } } },
        { $group: { _id: '$userId' } },
        { $count: 'n' }
      ]),
      Transaction.aggregate([
        { $match: { ...prevPeriodMatch, status: 'success', type: { $in: ['deposit_cash'] } } },
        { $group: { _id: '$userId' } },
        { $count: 'n' }
      ]),
      Transaction.aggregate([
        { $match: { ...periodMatch, status: 'success', type: { $in: ['deposit_cash'] } } },
        { $group: { _id: null, sum: { $sum: '$amount' } } }
      ]),
      Transaction.aggregate([
        { $match: { ...prevPeriodMatch, status: 'success', type: { $in: ['deposit_cash'] } } },
        { $group: { _id: null, sum: { $sum: '$amount' } } }
      ]),

      Order.aggregate([
        { $match: { ...periodMatch, status: { $in: ['paid', 'delivered', 'replaced'] } } },
        { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: '$amount' } } }
      ]),
      Order.aggregate([
        { $match: { ...prevPeriodMatch, status: { $in: ['paid', 'delivered', 'replaced'] } } },
        { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: '$amount' } } }
      ]),

      ServiceOrder.aggregate([
        { $match: { ...periodMatch, paymentStatus: 'paid' } },
        { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: '$amountPaid' } } }
      ]),
      ServiceOrder.aggregate([
        { $match: { ...prevPeriodMatch, paymentStatus: 'paid' } },
        { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: '$amountPaid' } } }
      ]),

      Preorder.aggregate([
        { $match: { ...periodMatch, paymentStatus: 'paid' } },
        { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: '$amountPaid' } } }
      ]),
      Preorder.aggregate([
        { $match: { ...prevPeriodMatch, paymentStatus: 'paid' } },
        { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: '$amountPaid' } } }
      ]),

      SupportTicket.countDocuments({ status: { $in: ['open', 'pending'] } }),

      Order.aggregate([
        { $match: { ...periodMatch, status: { $in: ['paid', 'delivered', 'replaced'] } } },
        { $group: { _id: { $dateToString: { format: bucket.fmt, date: '$createdAt' } }, orders: { $sum: '$amount' } } }
      ]),
      ServiceOrder.aggregate([
        { $match: { ...periodMatch, paymentStatus: 'paid' } },
        { $group: { _id: { $dateToString: { format: bucket.fmt, date: '$createdAt' } }, services: { $sum: '$amountPaid' } } }
      ]),
      Preorder.aggregate([
        { $match: { ...periodMatch, paymentStatus: 'paid' } },
        { $group: { _id: { $dateToString: { format: bucket.fmt, date: '$createdAt' } }, preorders: { $sum: '$amountPaid' } } }
      ]),

      CustomerUser.aggregate([
        { $match: periodMatch },
        { $group: { _id: { $dateToString: { format: bucket.fmt, date: '$createdAt' } }, newUsers: { $sum: 1 } } }
      ]),
      Transaction.aggregate([
        { $match: { ...periodMatch, status: 'success', type: { $in: ['deposit_cash'] } } },
        { $group: { _id: { $dateToString: { format: bucket.fmt, date: '$createdAt' } }, deposits: { $sum: '$amount' } } }
      ]),

      Order.aggregate([
        { $match: { ...periodMatch, status: { $in: ['paid', 'delivered', 'replaced'] } } },
        { $group: {
          _id: '$productId',
          title: { $first: '$productSnapshot.title' },
          image: { $first: '$productSnapshot.image' },
          productType: { $first: '$productType' },
          qty: { $sum: '$quantity' },
          revenue: { $sum: '$amount' }
        } },
        { $sort: { revenue: -1 } },
        { $limit: TOP_LIMIT + 1 }
      ]),
      Order.aggregate([
        { $match: { ...periodMatch, status: { $in: ['paid', 'delivered', 'replaced'] } } },
        { $group: { _id: '$customerId', orders: { $sum: 1 }, spent: { $sum: '$amount' } } },
        { $sort: { spent: -1 } },
        { $limit: TOP_LIMIT + 1 },
        { $lookup: { from: 'customerusers', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        { $project: { _id: 1, orders: 1, spent: 1, uid: '$user.uid', username: '$user.username' } }
      ]),
      ServiceOrder.aggregate([
        { $match: { ...periodMatch, paymentStatus: 'paid' } },
        { $group: {
          _id: '$serviceId',
          title: { $first: '$serviceSnapshot.title' },
          qty: { $sum: 1 },
          revenue: { $sum: '$amountPaid' }
        } },
        { $sort: { revenue: -1 } },
        { $limit: TOP_LIMIT + 1 }
      ])
    ]);

    const slice = (arr) => ({
      items: arr.slice(0, TOP_LIMIT),
      hasMore: arr.length > TOP_LIMIT
    });
    const productsPage = slice(topProducts);
    const customersPage = slice(topCustomers);
    const servicesPage = slice(topServices);

    const mergedRevenueMap = new Map();
    const addToSeries = (arr, key) => {
      for (const r of arr) {
        if (!mergedRevenueMap.has(r._id)) mergedRevenueMap.set(r._id, { _id: r._id, orders: 0, services: 0, preorders: 0 });
        mergedRevenueMap.get(r._id)[key] = safeNum(r[key]);
      }
    };
    addToSeries(revenueSeriesOrders, 'orders');
    addToSeries(revenueSeriesServices, 'services');
    addToSeries(revenueSeriesPreorders, 'preorders');
    const mergedRevenue = Array.from(mergedRevenueMap.values()).sort((a, b) => (a._id > b._id ? 1 : -1));

    const mergedUsersMap = new Map();
    for (const r of usersSeries) mergedUsersMap.set(r._id, { _id: r._id, newUsers: safeNum(r.newUsers), deposits: 0 });
    for (const r of depositSeries) {
      const cur = mergedUsersMap.get(r._id) || { _id: r._id, newUsers: 0, deposits: 0 };
      cur.deposits = safeNum(r.deposits);
      mergedUsersMap.set(r._id, cur);
    }
    const mergedUsers = Array.from(mergedUsersMap.values()).sort((a, b) => (a._id > b._id ? 1 : -1));

    const revenuePoints = fillSeries(mergedRevenue, from, to, bucket.unit, ['orders', 'services', 'preorders']);
    const usersPoints = fillSeries(mergedUsers, from, to, bucket.unit, ['newUsers', 'deposits']);

    const ordersSum = safeNum(ordersAgg[0]?.sum);
    const servicesSum = safeNum(servicesAgg[0]?.sum);
    const preordersSum = safeNum(preordersAgg[0]?.sum);

    const payload = {
      range: { from, to, prevFrom, prevTo, bucket: bucket.unit },
      kpi: {
        newUsers: { value: newUsersCur, prev: newUsersPrev },
        online: { value: onlineCustomers?.size || 0 },
        depositors: { value: safeNum(depositorsCur[0]?.n), prev: safeNum(depositorsPrev[0]?.n) },
        depositSum: { value: safeNum(depositSumCur[0]?.sum), prev: safeNum(depositSumPrev[0]?.sum) },
        orders: { count: safeNum(ordersAgg[0]?.count), sum: ordersSum, prevCount: safeNum(ordersAggPrev[0]?.count), prevSum: safeNum(ordersAggPrev[0]?.sum) },
        services: { count: safeNum(servicesAgg[0]?.count), sum: servicesSum, prevCount: safeNum(servicesAggPrev[0]?.count), prevSum: safeNum(servicesAggPrev[0]?.sum) },
        preorders: { count: safeNum(preordersAgg[0]?.count), sum: preordersSum, prevCount: safeNum(preordersAggPrev[0]?.count), prevSum: safeNum(preordersAggPrev[0]?.sum) },
        openTickets: { value: openTickets }
      },
      revenueSeries: { bucket: bucket.unit, points: revenuePoints },
      usersSeries: usersPoints,
      revenueSplit: { orders: ordersSum, services: servicesSum, preorders: preordersSum }
    };

    const productItems = await attachProductUids(productsPage.items.map((p) => ({
      id: p._id, title: p.title || '—', image: p.image || '', productType: p.productType || '', qty: p.qty, revenue: p.revenue
    })));
    const serviceItems = await attachServiceUids(servicesPage.items.map((s) => ({
      id: s._id, title: s.title || '—', qty: s.qty, revenue: s.revenue
    })));

    res.json({
      ...payload,
      topProducts: { items: productItems, hasMore: productsPage.hasMore },
      topCustomers: {
        items: customersPage.items.map((c) => ({
          id: c._id, uid: c.uid || '', username: c.username || '—', orders: c.orders, spent: c.spent
        })),
        hasMore: customersPage.hasMore
      },
      topServices: { items: serviceItems, hasMore: servicesPage.hasMore }
    });
  } catch (e) {
    console.error('[dashboard] error', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getTop = async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const periodMatch = { createdAt: { $gte: from, $lte: to } };
    const kind = String(req.params.kind || '');
    const page = clampPage(req.query.page);
    const skip = (page - 1) * TOP_LIMIT;

    let items = [];
    if (kind === 'products') {
      const raw = await Order.aggregate([
        { $match: { ...periodMatch, status: { $in: ['paid', 'delivered', 'replaced'] } } },
        { $group: {
          _id: '$productId',
          title: { $first: '$productSnapshot.title' },
          image: { $first: '$productSnapshot.image' },
          productType: { $first: '$productType' },
          qty: { $sum: '$quantity' },
          revenue: { $sum: '$amount' }
        } },
        { $sort: { revenue: -1 } },
        { $skip: skip },
        { $limit: TOP_LIMIT + 1 }
      ]);
      const hasMore = raw.length > TOP_LIMIT;
      items = await attachProductUids(raw.slice(0, TOP_LIMIT).map((p) => ({
        id: p._id, title: p.title || '—', image: p.image || '', productType: p.productType || '', qty: p.qty, revenue: p.revenue
      })));
      return res.json({ items, hasMore, page });
    }
    if (kind === 'customers') {
      const raw = await Order.aggregate([
        { $match: { ...periodMatch, status: { $in: ['paid', 'delivered', 'replaced'] } } },
        { $group: { _id: '$customerId', orders: { $sum: 1 }, spent: { $sum: '$amount' } } },
        { $sort: { spent: -1 } },
        { $skip: skip },
        { $limit: TOP_LIMIT + 1 },
        { $lookup: { from: 'customerusers', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        { $project: { _id: 1, orders: 1, spent: 1, uid: '$user.uid', username: '$user.username' } }
      ]);
      const hasMore = raw.length > TOP_LIMIT;
      items = raw.slice(0, TOP_LIMIT).map((c) => ({
        id: c._id, uid: c.uid || '', username: c.username || '—', orders: c.orders, spent: c.spent
      }));
      return res.json({ items, hasMore, page });
    }
    if (kind === 'services') {
      const raw = await ServiceOrder.aggregate([
        { $match: { ...periodMatch, paymentStatus: 'paid' } },
        { $group: {
          _id: '$serviceId',
          title: { $first: '$serviceSnapshot.title' },
          qty: { $sum: 1 },
          revenue: { $sum: '$amountPaid' }
        } },
        { $sort: { revenue: -1 } },
        { $skip: skip },
        { $limit: TOP_LIMIT + 1 }
      ]);
      const hasMore = raw.length > TOP_LIMIT;
      items = await attachServiceUids(raw.slice(0, TOP_LIMIT).map((s) => ({
        id: s._id, title: s.title || '—', qty: s.qty, revenue: s.revenue
      })));
      return res.json({ items, hasMore, page });
    }

    return res.status(400).json({ message: 'Unknown kind' });
  } catch (e) {
    console.error('[dashboard/top] error', e);
    res.status(500).json({ message: 'Server error' });
  }
};
