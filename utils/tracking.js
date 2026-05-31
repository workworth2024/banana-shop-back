import geoip from 'geoip-lite';
import crypto from 'crypto';
import TrackingLink from '../models/TrackingLink.js';
import TrackingEvent from '../models/TrackingEvent.js';
import CustomerUser from '../models/CustomerUser.js';

export const TL_REF_COOKIE = 'tl_ref';
export const TL_VID_COOKIE = 'tl_vid';
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60 * 1000; // 90 days

export function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

export function geoFromReq(req) {
  try {
    const ip = getClientIp(req);
    if (!ip) return '';
    const clean = ip.replace(/^::ffff:/, '');
    const found = geoip.lookup(clean);
    return found?.country || '';
  } catch {
    return '';
  }
}

export function parseDevice(uaRaw) {
  const ua = String(uaRaw || '');
  if (!ua) return { type: 'unknown', os: '', browser: '' };

  let type = 'desktop';
  if (/bot|crawler|spider|crawling/i.test(ua)) type = 'bot';
  else if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) type = 'tablet';
  else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|IEMobile|Opera Mini/i.test(ua)) type = 'mobile';

  let os = '';
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = '';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = 'Safari';

  return { type, os, browser };
}

export function ensureVisitorId(req) {
  const existing = req.cookies?.[TL_VID_COOKIE];
  if (existing && /^[a-f0-9]{16,40}$/i.test(existing)) {
    return { visitorId: existing, isNew: false };
  }
  return { visitorId: crypto.randomBytes(12).toString('hex'), isNew: true };
}

export function setTrackingCookies(res, { code, visitorId }) {
  const opts = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE
  };
  if (code) res.cookie(TL_REF_COOKIE, code, opts);
  if (visitorId) res.cookie(TL_VID_COOKIE, visitorId, opts);
}

/**
 * Records a click for a smart link. Returns the visitorId used.
 */
export async function recordClick({ req, link, visitorId, isNewVisitor }) {
  const geo = geoFromReq(req);
  const device = parseDevice(req.headers['user-agent']);
  const referrer = String(req.headers['referer'] || req.body?.referrer || '').slice(0, 500);

  await TrackingEvent.create({
    linkId: link._id,
    linkCode: link.code,
    type: 'click',
    visitorId,
    geo,
    device,
    referrer
  });

  const inc = { 'stats.clicks': 1 };
  if (isNewVisitor) inc['stats.uniqueVisitors'] = 1;
  await TrackingLink.updateOne({ _id: link._id }, { $inc: inc });

  return { geo, device };
}

/**
 * First-touch attribution: links a freshly registered customer to the smart link
 * referenced by their tl_ref cookie (or explicit code). Fire-and-forget safe.
 */
export async function attachAcquisition({ user, code, req }) {
  try {
    const ref = code || req?.cookies?.[TL_REF_COOKIE];
    if (!ref || !user?._id) return;

    const link = await TrackingLink.findOne({ code: String(ref) });
    if (!link || !link.isActive) return;

    const subsObj = {};
    for (const s of link.subs || []) {
      if (s?.key) subsObj[s.key] = s.value;
    }
    const geo = geoFromReq(req);
    const device = parseDevice(req?.headers?.['user-agent']);

    await CustomerUser.updateOne(
      { _id: user._id },
      {
        $set: {
          acquisition: {
            linkId: link._id,
            linkCode: link.code,
            utm: {
              source: link.utm?.source || '',
              medium: link.utm?.medium || '',
              campaign: link.utm?.campaign || '',
              term: link.utm?.term || '',
              content: link.utm?.content || ''
            },
            subs: subsObj,
            geo,
            device,
            landedAt: new Date()
          }
        }
      }
    );

    await TrackingEvent.create({
      linkId: link._id,
      linkCode: link.code,
      type: 'registration',
      customerId: user._id,
      geo,
      device
    });

    await TrackingLink.updateOne({ _id: link._id }, { $inc: { 'stats.registrations': 1 } });
  } catch (e) {
    console.error('[Tracking] attachAcquisition error:', e.message);
  }
}

function pickDevice(d) {
  if (d && d.type && d.type !== 'unknown') {
    return { type: d.type, os: d.os || '', browser: d.browser || '' };
  }
  return null;
}

const PURCHASE_TYPE_MAP = {
  order: 'order',
  service_order: 'service',
  preorder: 'preorder'
};

/**
 * Records a monetary event for the smart link that acquired this customer.
 * Idempotent per (linkId, type, orderId). Fire-and-forget safe.
 */
export async function recordPurchase({ customerId, amount, orderType, orderId, orderUid, productType }) {
  try {
    if (!customerId) return;
    const eventType = PURCHASE_TYPE_MAP[orderType];
    if (!eventType) return;

    const customer = await CustomerUser.findById(customerId).select('acquisition');
    const linkId = customer?.acquisition?.linkId;
    const linkCode = customer?.acquisition?.linkCode;
    if (!linkId) return;

    const link = await TrackingLink.findById(linkId).select('isActive');
    if (!link || !link.isActive) return;

    if (orderId) {
      const existing = await TrackingEvent.findOne({
        linkId,
        type: eventType,
        'meta.orderId': String(orderId)
      });
      if (existing) return;
    }

    const value = Math.abs(parseFloat(amount) || 0);

    let device = pickDevice(customer?.acquisition?.device);
    if (!device) {
      const regEvt = await TrackingEvent.findOne({ customerId, type: 'registration' })
        .select('device')
        .sort({ createdAt: 1 });
      device = pickDevice(regEvt?.device);
    }

    await TrackingEvent.create({
      linkId,
      linkCode,
      type: eventType,
      customerId,
      amount: value,
      geo: customer?.acquisition?.geo || '',
      device: device || undefined,
      meta: {
        orderId: orderId ? String(orderId) : '',
        orderUid: orderUid || '',
        productType: productType || ''
      }
    });

    if (device) {
      await TrackingEvent.updateMany(
        {
          customerId,
          type: { $in: ['order', 'service', 'preorder'] },
          $or: [{ 'device.type': { $exists: false } }, { 'device.type': 'unknown' }, { device: null }]
        },
        { $set: { device } }
      ).catch(() => {});
    }

    await TrackingLink.updateOne(
      { _id: linkId },
      { $inc: { 'stats.purchases': 1, 'stats.revenue': value } }
    );
  } catch (e) {
    console.error('[Tracking] recordPurchase error:', e.message);
  }
}
