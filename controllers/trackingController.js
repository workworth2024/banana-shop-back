import mongoose from 'mongoose';
import TrackingLink from '../models/TrackingLink.js';
import TrackingEvent from '../models/TrackingEvent.js';
import {
  recordClick,
  ensureVisitorId,
  setTrackingCookies
} from '../utils/tracking.js';

const STOREFRONT_URL = (process.env.STOREFRONT_URL || 'https://banana-traff-shop.com').replace(/\/+$/, '');

function buildLinkUrl(link) {
  let path = link.targetPath || '/';
  if (!path.startsWith('/')) path = '/' + path;
  const params = new URLSearchParams();
  params.set('utm_id', link.code);
  const u = link.utm || {};
  if (u.source) params.set('utm_source', u.source);
  if (u.medium) params.set('utm_medium', u.medium);
  if (u.campaign) params.set('utm_campaign', u.campaign);
  if (u.term) params.set('utm_term', u.term);
  if (u.content) params.set('utm_content', u.content);
  for (const s of link.subs || []) {
    if (s?.key) params.set(s.key, s.value || '');
  }
  return `${STOREFRONT_URL}${path}?${params.toString()}`;
}

function serializeLink(linkDoc) {
  const link = linkDoc.toObject ? linkDoc.toObject() : linkDoc;
  return { ...link, url: buildLinkUrl(link) };
}

function sanitizeSubs(subs) {
  if (!Array.isArray(subs)) return [];
  return subs
    .filter((s) => s && String(s.key || '').trim())
    .slice(0, 30)
    .map((s) => ({
      key: String(s.key).trim().slice(0, 60),
      value: String(s.value ?? '').trim().slice(0, 200)
    }));
}

function sanitizeUtm(utm = {}) {
  const pick = (v) => String(v ?? '').trim().slice(0, 120);
  return {
    source: pick(utm.source),
    medium: pick(utm.medium),
    campaign: pick(utm.campaign),
    term: pick(utm.term),
    content: pick(utm.content)
  };
}

function parseRange(req) {
  const { from, to } = req.query;
  const match = {};
  if (from) {
    const d = new Date(from);
    if (!isNaN(d)) match.$gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!isNaN(d)) { d.setHours(23, 59, 59, 999); match.$lte = d; }
  }
  return Object.keys(match).length ? match : null;
}

/* ============ PUBLIC ============ */

// POST /api/v3/tracking/hit  { code, referrer }
export const hit = async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!code || code.length > 40) return res.status(200).json({ ok: false });

    const link = await TrackingLink.findOne({ code });
    if (!link || !link.isActive) {
      return res.status(200).json({ ok: false });
    }

    const { visitorId, isNew } = ensureVisitorId(req);
    await recordClick({ req, link, visitorId, isNewVisitor: isNew });
    setTrackingCookies(res, { code, visitorId });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[Tracking] hit error:', e.message);
    return res.status(200).json({ ok: false });
  }
};

/* ============ CRM (staff) ============ */

async function perLinkStats(linkIds, range) {
  if (!linkIds.length) return new Map();
  const match = { linkId: { $in: linkIds } };
  if (range) match.createdAt = range;

  const [typeAgg, uniqAgg] = await Promise.all([
    TrackingEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$linkId',
          clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
          registrations: { $sum: { $cond: [{ $eq: ['$type', 'registration'] }, 1, 0] } },
          purchases: { $sum: { $cond: [{ $in: ['$type', ['order', 'service', 'preorder']] }, 1, 0] } },
          revenue: { $sum: '$amount' }
        }
      }
    ]),
    TrackingEvent.aggregate([
      { $match: { ...match, type: 'click', visitorId: { $nin: ['', null] } } },
      { $group: { _id: { l: '$linkId', v: '$visitorId' } } },
      { $group: { _id: '$_id.l', uniqueClicks: { $sum: 1 } } }
    ])
  ]);

  const uniqMap = new Map(uniqAgg.map((u) => [String(u._id), u.uniqueClicks]));
  const map = new Map();
  for (const r of typeAgg) {
    map.set(String(r._id), {
      clicks: r.clicks,
      uniqueClicks: uniqMap.get(String(r._id)) || 0,
      registrations: r.registrations,
      purchases: r.purchases,
      revenue: parseFloat((r.revenue || 0).toFixed(2))
    });
  }
  return map;
}

// GET /api/v3/tracking/links
export const listLinks = async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().slice(0, 100);
    const filter = { ...buildLinkFilter(req.query) };
    if (search) {
      const rx = { $regex: search, $options: 'i' };
      filter.$or = [
        { name: rx },
        { code: rx },
        { 'utm.source': rx },
        { 'utm.medium': rx },
        { 'utm.campaign': rx },
        { 'utm.term': rx },
        { 'utm.content': rx },
        { 'subs.key': rx },
        { 'subs.value': rx }
      ];
    }
    const links = await TrackingLink.find(filter).sort({ createdAt: -1 }).limit(500);

    const range = parseRange(req);
    const statsMap = await perLinkStats(links.map((l) => l._id), range);

    const out = links.map((l) => {
      const base = serializeLink(l);
      const ps = statsMap.get(String(l._id)) || {
        clicks: 0, uniqueClicks: 0, registrations: 0, purchases: 0, revenue: 0
      };
      base.stats = { ...base.stats, ...ps };
      return base;
    });

    return res.json({ links: out });
  } catch (e) {
    console.error('[Tracking] listLinks error:', e.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/v3/tracking/links
export const createLink = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    if (!name) return res.status(400).json({ message: 'Name is required' });

    const link = await TrackingLink.create({
      name,
      targetPath: String(req.body?.targetPath || '/').trim().slice(0, 300) || '/',
      utm: sanitizeUtm(req.body?.utm),
      subs: sanitizeSubs(req.body?.subs),
      isActive: req.body?.isActive !== false,
      createdBy: req.user?.id || req.user?._id || null
    });

    return res.status(201).json({ link: serializeLink(link) });
  } catch (e) {
    console.error('[Tracking] createLink error:', e.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// PATCH /api/v3/tracking/links/:id
export const updateLink = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const update = {};
    if (req.body.name !== undefined) update.name = String(req.body.name).trim().slice(0, 120);
    if (req.body.targetPath !== undefined) update.targetPath = String(req.body.targetPath).trim().slice(0, 300) || '/';
    if (req.body.utm !== undefined) update.utm = sanitizeUtm(req.body.utm);
    if (req.body.subs !== undefined) update.subs = sanitizeSubs(req.body.subs);
    if (req.body.isActive !== undefined) update.isActive = !!req.body.isActive;

    const link = await TrackingLink.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!link) return res.status(404).json({ message: 'Link not found' });
    return res.json({ link: serializeLink(link) });
  } catch (e) {
    console.error('[Tracking] updateLink error:', e.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// DELETE /api/v3/tracking/links/:id
export const deleteLink = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const link = await TrackingLink.findByIdAndDelete(req.params.id);
    if (!link) return res.status(404).json({ message: 'Link not found' });
    await TrackingEvent.deleteMany({ linkId: link._id }).catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Tracking] deleteLink error:', e.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

function emptyTotals() {
  return { clicks: 0, uniqueVisitors: 0, registrations: 0, orders: 0, services: 0, preorders: 0, purchases: 0, revenue: 0 };
}

async function computeTotals(matchBase) {
  const byType = await TrackingEvent.aggregate([
    { $match: matchBase },
    { $group: { _id: '$type', count: { $sum: 1 }, revenue: { $sum: '$amount' } } }
  ]);
  const uniqueAgg = await TrackingEvent.aggregate([
    { $match: { ...matchBase, type: 'click', visitorId: { $nin: ['', null] } } },
    { $group: { _id: '$visitorId' } },
    { $count: 'n' }
  ]);

  const totals = emptyTotals();
  totals.uniqueVisitors = uniqueAgg[0]?.n || 0;
  for (const row of byType) {
    if (row._id === 'click') totals.clicks = row.count;
    else if (row._id === 'registration') totals.registrations = row.count;
    else if (row._id === 'order') { totals.orders = row.count; totals.revenue += row.revenue; totals.purchases += row.count; }
    else if (row._id === 'service') { totals.services = row.count; totals.revenue += row.revenue; totals.purchases += row.count; }
    else if (row._id === 'preorder') { totals.preorders = row.count; totals.revenue += row.revenue; totals.purchases += row.count; }
  }
  totals.revenue = parseFloat(totals.revenue.toFixed(2));
  return totals;
}

async function breakdown(matchBase, field) {
  return TrackingEvent.aggregate([
    { $match: matchBase },
    {
      $group: {
        _id: field,
        clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
        registrations: { $sum: { $cond: [{ $eq: ['$type', 'registration'] }, 1, 0] } },
        purchases: { $sum: { $cond: [{ $in: ['$type', ['order', 'service', 'preorder']] }, 1, 0] } },
        revenue: { $sum: '$amount' }
      }
    },
    { $sort: { clicks: -1, purchases: -1 } },
    { $limit: 100 }
  ]);
}

async function deviceBreakdown(matchBase) {
  const rows = await TrackingEvent.aggregate([
    { $match: matchBase },
    {
      $group: {
        _id: {
          type: { $ifNull: ['$device.type', 'unknown'] },
          os: { $ifNull: ['$device.os', ''] }
        },
        clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
        registrations: { $sum: { $cond: [{ $eq: ['$type', 'registration'] }, 1, 0] } },
        purchases: { $sum: { $cond: [{ $in: ['$type', ['order', 'service', 'preorder']] }, 1, 0] } },
        revenue: { $sum: '$amount' }
      }
    },
    { $sort: { clicks: -1, purchases: -1 } },
    { $limit: 100 }
  ]);
  return rows.map((r) => ({
    device: r._id.type || 'unknown',
    os: r._id.os || '',
    clicks: r.clicks,
    registrations: r.registrations,
    purchases: r.purchases,
    revenue: r.revenue
  }));
}

// Builds a TrackingLink filter from affiliate-style UTM / sub query params.
function buildLinkFilter(query = {}) {
  const filter = {};
  const map = {
    utm_source: 'utm.source',
    utm_medium: 'utm.medium',
    utm_campaign: 'utm.campaign',
    utm_term: 'utm.term',
    utm_content: 'utm.content'
  };
  for (const [q, path] of Object.entries(map)) {
    const v = String(query[q] || '').trim();
    if (v) filter[path] = v;
  }
  const subKey = String(query.subKey || '').trim();
  const subValue = String(query.subValue || '').trim();
  if (subKey && subValue) filter.subs = { $elemMatch: { key: subKey, value: subValue } };
  else if (subKey) filter.subs = { $elemMatch: { key: subKey } };
  return filter;
}

async function timeseries(matchBase) {
  return TrackingEvent.aggregate([
    { $match: matchBase },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
        registrations: { $sum: { $cond: [{ $eq: ['$type', 'registration'] }, 1, 0] } },
        purchases: { $sum: { $cond: [{ $in: ['$type', ['order', 'service', 'preorder']] }, 1, 0] } },
        revenue: { $sum: '$amount' }
      }
    },
    { $sort: { _id: 1 } },
    { $limit: 180 }
  ]);
}

// GET /api/v3/tracking/links/:id/stats
export const getLinkStats = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const link = await TrackingLink.findById(req.params.id);
    if (!link) return res.status(404).json({ message: 'Link not found' });

    const matchBase = { linkId: link._id };
    const range = parseRange(req);
    if (range) matchBase.createdAt = range;

    const [totals, byGeo, byDevice, daily] = await Promise.all([
      computeTotals(matchBase),
      breakdown(matchBase, '$geo'),
      deviceBreakdown(matchBase),
      timeseries(matchBase)
    ]);

    return res.json({
      link: serializeLink(link),
      totals,
      byGeo: byGeo.map((g) => ({ geo: g._id || '—', ...g, _id: undefined })),
      byDevice,
      timeseries: daily.map((d) => ({ date: d._id, ...d, _id: undefined }))
    });
  } catch (e) {
    console.error('[Tracking] getLinkStats error:', e.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/v3/tracking/dashboard
export const getDashboard = async (req, res) => {
  try {
    const matchBase = {};
    const range = parseRange(req);
    if (range) matchBase.createdAt = range;

    // Affiliate-style filtering: constrain to links matching given UTM / sub params.
    const linkFilter = buildLinkFilter(req.query);
    let filteredLinks = false;
    if (Object.keys(linkFilter).length) {
      const matchIds = await TrackingLink.find(linkFilter).select('_id');
      matchBase.linkId = { $in: matchIds.map((d) => d._id) };
      filteredLinks = true;
    }

    const [totals, byGeo, byDevice, daily, perLink, linkCount] = await Promise.all([
      computeTotals(matchBase),
      breakdown(matchBase, '$geo'),
      deviceBreakdown(matchBase),
      timeseries(matchBase),
      TrackingEvent.aggregate([
        { $match: matchBase },
        {
          $group: {
            _id: '$linkId',
            linkCode: { $first: '$linkCode' },
            clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
            registrations: { $sum: { $cond: [{ $eq: ['$type', 'registration'] }, 1, 0] } },
            purchases: { $sum: { $cond: [{ $in: ['$type', ['order', 'service', 'preorder']] }, 1, 0] } },
            revenue: { $sum: '$amount' }
          }
        },
        { $sort: { revenue: -1, clicks: -1 } },
        { $limit: 20 }
      ]),
      filteredLinks ? TrackingLink.countDocuments(linkFilter) : TrackingLink.countDocuments({})
    ]);

    const linkIds = perLink.map((r) => r._id).filter(Boolean);
    const linkDocs = await TrackingLink.find({ _id: { $in: linkIds } }).select('name code');
    const nameById = new Map(linkDocs.map((l) => [String(l._id), l.name]));

    return res.json({
      totals,
      linkCount,
      topLinks: perLink.map((r) => ({
        linkId: r._id,
        name: nameById.get(String(r._id)) || r.linkCode || '—',
        code: r.linkCode || '',
        clicks: r.clicks,
        registrations: r.registrations,
        purchases: r.purchases,
        revenue: parseFloat((r.revenue || 0).toFixed(2))
      })),
      byGeo: byGeo.map((g) => ({ geo: g._id || '—', ...g, _id: undefined })),
      byDevice,
      timeseries: daily.map((d) => ({ date: d._id, ...d, _id: undefined }))
    });
  } catch (e) {
    console.error('[Tracking] getDashboard error:', e.message);
    return res.status(500).json({ message: 'Server error' });
  }
};
