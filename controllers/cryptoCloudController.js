import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import CryptoCloudInvoice from '../models/CryptoCloudInvoice.js';
import CustomerUser from '../models/CustomerUser.js';
import Transaction from '../models/Transaction.js';
import DigitalItem from '../models/DigitalItem.js';
import Order from '../models/Order.js';
import GoogleAdsProduct from '../models/GoogleAdsProduct.js';
import YoutubeProduct from '../models/YoutubeProduct.js';
import Service from '../models/Service.js';
import ServiceOrder from '../models/ServiceOrder.js';
import Preorder from '../models/Preorder.js';
import { io } from '../server.js';
import { createAdminNotif } from './adminNotifController.js';
import { bunnyUpload, generateFilename } from '../utils/bunnyStorage.js';
import { deleteAnyFile } from '../utils/deleteFile.js';
import { isValidGeo } from '../utils/geos.js';
import { syncProductCounts, syncManyProductCounts } from '../utils/syncProductCounts.js';
import { creditReferralReward } from '../utils/referral.js';
import { recordPurchase } from '../utils/tracking.js';
import { grantAnalyzerCredits } from '../utils/analyzerCredits.js';
import { getEffectiveUnitPrice } from '../utils/pricing.js';
import { notifyCustomer } from '../utils/notify.js';

const getApiUrl = () => process.env.CRYPTOCLOUD_API_URL || 'https://api.cryptocloud.plus';
const getApiKey = () => process.env.CRYPTOCLOUD_API_KEY;
const getShopId = () => process.env.CRYPTOCLOUD_SHOP_ID;
const getSecret = () => process.env.CRYPTOCLOUD_SECRET;
const getProjectId = () => process.env.CRYPTOCLOUD_PROJECT_ID;

// The API key travels in every request — never send it over plain http in prod.
if (process.env.NODE_ENV === 'production' && new URL(getApiUrl()).protocol !== 'https:') {
  throw new Error('CRYPTOCLOUD_API_URL must be https in production');
}

// "partial" is NOT paid: fulfilling on it handed out goods for a fraction of the price.
const PAID_STATUSES = new Set(['paid', 'overpaid']);

const MAX_TOKEN_LENGTH = 4096;
const MAX_TOKEN_TTL_SEC = 15 * 60;
const MAX_API_RESPONSE_BYTES = 512 * 1024;
const POSTBACK_LOG_SIZE = 30;
const INVOICE_ID_RE = /^[A-Z0-9]{4,32}$/;
const PAY_LINK_RE = /^https:\/\/([a-z0-9-]+\.)*(trybit\.com|cryptocloud\.plus)(\/|$)/i;

const isDebug = () => process.env.CRYPTOCLOUD_DEBUG !== '0';
const log = (...args) => { if (isDebug()) console.log('[CryptoCloud]', ...args); };
const warn = (...args) => console.warn('[CryptoCloud]', ...args);
const err = (...args) => console.error('[CryptoCloud]', ...args);

const getProductModel = (productType) => {
  if (productType === 'GoogleAdsProduct') return GoogleAdsProduct;
  if (productType === 'YoutubeProduct') return YoutubeProduct;
  return null;
};

const releaseReservations = async (reservedIds) => {
  if (!reservedIds || !reservedIds.length) return;
  try {
    const items = await DigitalItem.find(
      { _id: { $in: reservedIds }, status: 'reserved' },
      { productId: 1, productType: 1 }
    ).lean();
    await DigitalItem.updateMany(
      { _id: { $in: reservedIds }, status: 'reserved' },
      { $set: { status: 'available', orderId: null } }
    );
    await syncManyProductCounts(items).catch(() => {});
  } catch (e) {
    err('releaseReservations failed:', e.message);
  }
};

// No redirects (the API key must not follow a Location to another host), bounded time and size.
async function ccApi(path, payload) {
  const res = await fetch(`${getApiUrl()}${path}`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${getApiKey()}` },
    body: JSON.stringify(payload)
  });
  if (Number(res.headers.get('content-length') || 0) > MAX_API_RESPONSE_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw new Error('API response too large');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.length;
    if (size > MAX_API_RESPONSE_BYTES) throw new Error('API response too large');
    chunks.push(chunk);
  }
  let data = {};
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* non-JSON error page */ }
  return { ok: res.ok, status: res.status, data };
}

async function requestCryptoCloudInvoice(invoiceDoc, customer, { ttlMinutes = 60 } = {}) {
  const body = {
    shop_id: getShopId(),
    amount: invoiceDoc.amount,
    currency: 'USD',
    order_id: invoiceDoc.orderId,
    email: customer?.email || undefined,
    add_fields: {
      time_to_pay: { hours: Math.floor(ttlMinutes / 60), minutes: ttlMinutes % 60 }
    }
  };

  const ccRes = await ccApi('/v2/invoice/create', body).catch((e) => ({ ok: false, status: 0, data: { error: e.message } }));
  const ccData = ccRes.data;
  log('CC invoice', invoiceDoc.intent, { http: ccRes.status, status: ccData?.status, link: !!ccData?.result?.link });

  if (!ccRes.ok || ccData?.status !== 'success' || !PAY_LINK_RE.test(String(ccData?.result?.link || ''))) {
    await CryptoCloudInvoice.updateOne({ _id: invoiceDoc._id }, { $set: { status: 'failed', rawResponse: ccData } });
    err('create invoice failed:', JSON.stringify(ccData));
    return { ok: false, data: ccData };
  }

  const result = ccData.result;
  await CryptoCloudInvoice.updateOne(
    { _id: invoiceDoc._id },
    {
      $set: {
        uuid: result.uuid || '',
        payLink: result.link || '',
        address: result.address || '',
        rawResponse: result
      }
    }
  );

  return { ok: true, result };
}

export const createTopupInvoice = async (req, res) => {
  try {
    if (!getApiKey() || !getShopId()) {
      return res.status(500).json({ message: 'CryptoCloud is not configured' });
    }

    const amount = parseFloat(req.body.amount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
      return res.status(400).json({ message: 'Invalid amount (min 1, max 100000)' });
    }

    const roundedAmount = parseFloat(amount.toFixed(2));
    const customer = req.customer;

    const invoiceDoc = await CryptoCloudInvoice.create({
      customerId: customer._id,
      amount: roundedAmount,
      currency: 'USD',
      status: 'created',
      intent: 'topup'
    });

    const cc = await requestCryptoCloudInvoice(invoiceDoc, customer, { ttlMinutes: 60 });
    if (!cc.ok) return res.status(502).json({ message: 'Failed to create payment invoice', details: cc.data });

    return res.status(201).json({
      orderId: invoiceDoc.orderId,
      uuid: cc.result.uuid,
      amount: roundedAmount,
      currency: 'USD',
      link: cc.result.link,
      expiry: cc.result.expiry_date
    });
  } catch (e) {
    err('createTopupInvoice error:', e);
    return res.status(500).json({ message: 'Server error', error: e?.message });
  }
};

async function reserveItemsForRequest(items, customerId) {
  const reserved = [];
  const enrichedItems = [];
  try {
    for (const it of items) {
      const productId = it.productId;
      const productType = it.productType;
      const geoCode = String(it.geo || '').trim().toUpperCase();
      const qty = Math.max(1, Math.min(50, parseInt(it.quantity, 10) || 1));

      if (!mongoose.isValidObjectId(productId)) throw new Error('Invalid product ID');
      const ProductModel = getProductModel(productType);
      if (!ProductModel) throw new Error('Invalid product type');
      if (!geoCode || !isValidGeo(geoCode)) throw new Error('Geo is required');

      const product = await ProductModel.findById(productId);
      if (!product) throw new Error('Product not found');
      const productGeoCodes = (product.geos || []).map(g => g.code);
      if (!productGeoCodes.includes(geoCode)) throw new Error(`Geo ${geoCode} is not available`);

      const reservedIds = [];
      for (let i = 0; i < qty; i++) {
        const di = await DigitalItem.findOneAndUpdate(
          { productId, productType, geo: geoCode, status: 'available' },
          { $set: { status: 'reserved' } },
          { returnDocument: 'after' }
        );
        if (!di) throw new Error(`Only ${reservedIds.length} items available for ${geoCode}`);
        reservedIds.push(di._id);
        reserved.push(di._id);
      }

      const titleRu = product.title?.ru || product.title?.en || product.name || '';
      const titleEn = product.title?.en || product.title?.ru || product.name || '';
      const descStr = product.desc?.ru || product.desc?.en || '';
      const unitPrice = getEffectiveUnitPrice(product, qty);

      enrichedItems.push({
        productId: String(productId),
        productType,
        geo: geoCode,
        quantity: qty,
        unitPrice,
        amount: parseFloat((unitPrice * qty).toFixed(2)),
        reservedIds: reservedIds.map(String),
        titleRu,
        titleEn,
        descStr,
        productImage: product.path_image || product.image || '',
        productSubType: product.type || ''
      });

      await syncProductCounts(productId, productType).catch(() => {});
    }
    return { enrichedItems };
  } catch (e) {
    await releaseReservations(reserved);
    throw e;
  }
}

export const checkoutProduct = async (req, res) => {
  const preCreatedOrderIds = [];
  try {
    if (!getApiKey() || !getShopId()) return res.status(500).json({ message: 'CryptoCloud is not configured' });

    const { productId, productType, quantity = 1, geo } = req.body;
    const geoCode = String(geo || '').trim().toUpperCase();
    const since58min = new Date(Date.now() - 58 * 60 * 1000);
    const existingOrder = await Order.findOne({
      customerId: req.customer._id,
      productId,
      geo: geoCode,
      status: 'unpaid',
      paymentMethod: 'cryptocloud',
      payLink: { $ne: '' },
      createdAt: { $gte: since58min }
    });
    if (existingOrder?.payLink) {
      log('checkoutProduct: returning existing invoice', existingOrder.uid);
      return res.status(200).json({
        orderId: existingOrder.ccInvoiceId || existingOrder.uid,
        link: existingOrder.payLink,
        amount: existingOrder.amount,
        currency: 'USD',
        existing: true
      });
    }
    const { enrichedItems } = await reserveItemsForRequest(
      [{ productId, productType, quantity, geo }],
      req.customer._id
    );

    const totalAmount = parseFloat(enrichedItems.reduce((s, i) => s + i.amount, 0).toFixed(2));

    for (const it of enrichedItems) {
      const order = await Order.create({
        customerId: req.customer._id,
        productId: it.productId,
        productType: it.productType,
        geo: it.geo,
        digitalItemId: new mongoose.Types.ObjectId(it.reservedIds[0]),
        digitalItemIds: it.reservedIds.map(id => new mongoose.Types.ObjectId(id)),
        quantity: it.quantity,
        productSnapshot: {
          title: it.titleRu,
          description: it.descStr,
          productType: it.productType,
          productSubType: it.productSubType || '',
          price: it.unitPrice,
          image: it.productImage || '',
          geo: it.geo
        },
        amount: parseFloat((it.unitPrice * it.quantity).toFixed(2)),
        currency: 'USD',
        paymentMethod: 'cryptocloud',
        status: 'unpaid'
      });
      preCreatedOrderIds.push(String(order._id));
    }

    const invoiceDoc = await CryptoCloudInvoice.create({
      customerId: req.customer._id,
      amount: totalAmount,
      currency: 'USD',
      status: 'created',
      intent: 'product',
      intentPayload: { items: enrichedItems, preCreatedOrderIds }
    });

    const cc = await requestCryptoCloudInvoice(invoiceDoc, req.customer, { ttlMinutes: 60 });
    if (!cc.ok) {
      await releaseReservations(enrichedItems.flatMap(i => i.reservedIds));
      await Order.deleteMany({ _id: { $in: preCreatedOrderIds } });
      return res.status(502).json({ message: 'Failed to create payment invoice', details: cc.data });
    }

    const payLink = cc.result.link || '';
    await Order.updateMany(
      { _id: { $in: preCreatedOrderIds } },
      { $set: { payLink, ccInvoiceId: String(invoiceDoc._id) } }
    );

    return res.status(201).json({
      orderId: invoiceDoc.orderId,
      uuid: cc.result.uuid,
      amount: totalAmount,
      currency: 'USD',
      link: cc.result.link,
      expiry: cc.result.expiry_date
    });
  } catch (e) {
    if (preCreatedOrderIds.length) await Order.deleteMany({ _id: { $in: preCreatedOrderIds } }).catch(() => {});
    err('checkoutProduct error:', e.message);
    return res.status(400).json({ message: e.message || 'Checkout error' });
  }
};

export const checkoutCart = async (req, res) => {
  const preCreatedOrderIds = [];
  try {
    if (!getApiKey() || !getShopId()) return res.status(500).json({ message: 'CryptoCloud is not configured' });

    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ message: 'No items' });

    const since58min = new Date(Date.now() - 58 * 60 * 1000);
    const existingInvoice = await CryptoCloudInvoice.findOne({
      customerId: req.customer._id,
      intent: 'cart',
      status: 'created',
      payLink: { $ne: '' },
      createdAt: { $gte: since58min }
    });
    if (existingInvoice?.payLink) {
      log('checkoutCart: returning existing invoice', existingInvoice.orderId);
      return res.status(200).json({
        orderId: existingInvoice.orderId,
        link: existingInvoice.payLink,
        amount: existingInvoice.amount,
        currency: 'USD',
        existing: true
      });
    }

    const { enrichedItems } = await reserveItemsForRequest(items, req.customer._id);
    const totalAmount = parseFloat(enrichedItems.reduce((s, i) => s + i.amount, 0).toFixed(2));

    for (const it of enrichedItems) {
      const order = await Order.create({
        customerId: req.customer._id,
        productId: it.productId,
        productType: it.productType,
        geo: it.geo,
        digitalItemId: new mongoose.Types.ObjectId(it.reservedIds[0]),
        digitalItemIds: it.reservedIds.map(id => new mongoose.Types.ObjectId(id)),
        quantity: it.quantity,
        productSnapshot: {
          title: it.titleRu,
          description: it.descStr,
          productType: it.productType,
          productSubType: it.productSubType || '',
          price: it.unitPrice,
          image: it.productImage || '',
          geo: it.geo
        },
        amount: parseFloat((it.unitPrice * it.quantity).toFixed(2)),
        currency: 'USD',
        paymentMethod: 'cryptocloud',
        status: 'unpaid'
      });
      preCreatedOrderIds.push(String(order._id));
    }

    const invoiceDoc = await CryptoCloudInvoice.create({
      customerId: req.customer._id,
      amount: totalAmount,
      currency: 'USD',
      status: 'created',
      intent: 'cart',
      intentPayload: { items: enrichedItems, preCreatedOrderIds }
    });

    const cc = await requestCryptoCloudInvoice(invoiceDoc, req.customer, { ttlMinutes: 60 });
    if (!cc.ok) {
      await releaseReservations(enrichedItems.flatMap(i => i.reservedIds));
      await Order.deleteMany({ _id: { $in: preCreatedOrderIds } });
      return res.status(502).json({ message: 'Failed to create payment invoice', details: cc.data });
    }

    const payLink = cc.result.link || '';
    await Order.updateMany(
      { _id: { $in: preCreatedOrderIds } },
      { $set: { payLink, ccInvoiceId: String(invoiceDoc._id) } }
    );

    return res.status(201).json({
      orderId: invoiceDoc.orderId,
      uuid: cc.result.uuid,
      amount: totalAmount,
      currency: 'USD',
      link: cc.result.link,
      expiry: cc.result.expiry_date
    });
  } catch (e) {
    if (preCreatedOrderIds.length) await Order.deleteMany({ _id: { $in: preCreatedOrderIds } }).catch(() => {});
    err('checkoutCart error:', e.message);
    return res.status(400).json({ message: e.message || 'Checkout error' });
  }
};

export const checkoutService = async (req, res) => {
  const customerId = req.customer._id;
  let serviceOrderId = null;
  const uploadedFiles = [];
  try {
    if (!getApiKey() || !getShopId()) return res.status(500).json({ message: 'CryptoCloud is not configured' });

    const { serviceId, responses } = req.body;
    if (!serviceId) return res.status(400).json({ message: 'serviceId required' });

    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    const chargeAmount = parseFloat(Number(service.price) || 0);
    if (chargeAmount <= 0) return res.status(400).json({ message: 'Стоимость услуги не задана' });

    let parsedResponses;
    try {
      parsedResponses = typeof responses === 'string' ? JSON.parse(responses || '[]') : (responses || []);
      if (!Array.isArray(parsedResponses)) parsedResponses = [];
    } catch {
      return res.status(400).json({ message: 'Некорректный формат ответов' });
    }

    for (const f of (req.files || [])) {
      const filename = generateFilename(f.originalname);
      const remotePath = `/service-orders/${filename}`;
      await bunnyUpload(remotePath, f.buffer, f.mimetype);
      uploadedFiles.push({
        path: remotePath,
        originalName: f.originalname,
        size: f.size,
        stepId: f.fieldname?.startsWith('step_') ? f.fieldname.replace('step_', '') : null
      });
    }

    const serviceTitle = service.title?.ru || service.title?.en || String(serviceId);

    const order = await ServiceOrder.create({
      customerId,
      serviceId,
      scenarioId: service.scenarioId || null,
      serviceSnapshot: { title: serviceTitle, price: chargeAmount },
      amountPaid: chargeAmount,
      currency: 'USD',
      paymentMethod: 'cryptocloud',
      paymentStatus: 'pending_payment',
      responses: parsedResponses,
      customerFiles: uploadedFiles
    });
    serviceOrderId = order._id;

    const invoiceDoc = await CryptoCloudInvoice.create({
      customerId,
      amount: chargeAmount,
      currency: 'USD',
      status: 'created',
      intent: 'service',
      intentPayload: { serviceOrderId: String(order._id) }
    });

    const cc = await requestCryptoCloudInvoice(invoiceDoc, req.customer, { ttlMinutes: 60 });
    if (!cc.ok) {
      await ServiceOrder.findByIdAndDelete(order._id).catch(() => {});
      for (const cf of uploadedFiles) { if (cf.path) deleteAnyFile(cf.path); }
      return res.status(502).json({ message: 'Failed to create payment invoice', details: cc.data });
    }

    const payLink = cc.result.link || '';
    await ServiceOrder.findByIdAndUpdate(order._id, { $set: { payLink, ccInvoiceId: String(invoiceDoc._id) } }).catch(() => {});

    return res.status(201).json({
      orderId: invoiceDoc.orderId,
      uuid: cc.result.uuid,
      serviceOrderUid: order.uid,
      amount: chargeAmount,
      currency: 'USD',
      link: cc.result.link,
      expiry: cc.result.expiry_date
    });
  } catch (e) {
    if (serviceOrderId) await ServiceOrder.findByIdAndDelete(serviceOrderId).catch(() => {});
    for (const cf of uploadedFiles) { if (cf.path) deleteAnyFile(cf.path); }
    err('checkoutService error:', e);
    return res.status(500).json({ message: e.message || 'Server error' });
  }
};

export const checkoutPreorder = async (req, res) => {
  try {
    if (!getApiKey() || !getShopId()) return res.status(500).json({ message: 'CryptoCloud is not configured' });

    const { google_item_id, youtube_item_id, name, telegram, desired_quantity, comment, geo, geoBreakdown } = req.body;

    let product = null;
    let productType = 'google';
    let productModelType = 'GoogleAdsProduct';

    if (youtube_item_id) {
      if (!mongoose.isValidObjectId(youtube_item_id)) return res.status(400).json({ message: 'Invalid product ID' });
      product = await YoutubeProduct.findById(youtube_item_id);
      productType = 'youtube';
      productModelType = 'YoutubeProduct';
    } else if (google_item_id) {
      if (!mongoose.isValidObjectId(google_item_id)) return res.status(400).json({ message: 'Invalid product ID' });
      product = await GoogleAdsProduct.findById(google_item_id);
      productType = 'google';
      productModelType = 'GoogleAdsProduct';
    } else {
      return res.status(400).json({ message: 'Укажите товар предзаказа (google_item_id или youtube_item_id)' });
    }

    if (!product) return res.status(404).json({ message: 'Товар не найден' });
    if (!name || !telegram) {
      return res.status(400).json({ message: 'Обязательные поля: name, telegram' });
    }

    const productGeoCodes = (product.geos || []).map(g => g.code);

    let breakdown = [];
    if (Array.isArray(geoBreakdown) && geoBreakdown.length) {
      breakdown = geoBreakdown
        .map(g => ({
          geo: String(g?.geo || '').trim().toUpperCase(),
          quantity: Math.max(1, Math.min(500, parseInt(g?.quantity, 10) || 0))
        }))
        .filter(g => g.geo && g.quantity > 0);
    } else if (geo) {
      const geoCode = String(geo || '').trim().toUpperCase();
      const q = Math.max(1, Math.min(500, parseInt(desired_quantity, 10) || 1));
      if (geoCode) breakdown = [{ geo: geoCode, quantity: q }];
    }

    if (!breakdown.length) return res.status(400).json({ message: 'Выберите гео для предзаказа' });
    for (const g of breakdown) {
      if (!isValidGeo(g.geo)) return res.status(400).json({ message: `Некорректное гео ${g.geo}` });
      if (productGeoCodes.length && !productGeoCodes.includes(g.geo)) {
        return res.status(400).json({ message: `Гео ${g.geo} недоступно для этого товара` });
      }
    }
    const seenGeos = new Set();
    for (const g of breakdown) {
      if (seenGeos.has(g.geo)) return res.status(400).json({ message: `Гео ${g.geo} указано дважды` });
      seenGeos.add(g.geo);
    }

    const qty = breakdown.reduce((s, g) => s + g.quantity, 0);
    if (qty <= 0 || qty > 500) return res.status(400).json({ message: 'Некорректное количество' });
    const geoCode = breakdown.map(g => g.geo).join(', ');
    const unitPrice = getEffectiveUnitPrice(product, qty);
    if (unitPrice <= 0) return res.status(400).json({ message: 'Предзаказ этого товара временно недоступен' });

    const totalAmount = parseFloat((unitPrice * qty).toFixed(2));
    const productTitleRu = product.title?.ru || product.title?.en || String(product._id);
    const productTitleEn = product.title?.en || product.title?.ru || String(product._id);

    const preorder = await Preorder.create({
      google_item_id: productType === 'google' ? product._id : null,
      youtube_item_id: productType === 'youtube' ? product._id : null,
      productType,
      customerId: req.customer._id,
      geo: geoCode,
      geoBreakdown: breakdown,
      name: String(name).trim().slice(0, 200),
      telegram: String(telegram).trim().slice(0, 100),
      desired_quantity: qty,
      comment: comment ? String(comment).trim().slice(0, 1000) : '',
      unitPriceSnapshot: unitPrice,
      amountPaid: totalAmount,
      currency: 'USD',
      paymentMethod: 'cryptocloud',
      paymentStatus: 'unpaid'
    });

    const invoiceDoc = await CryptoCloudInvoice.create({
      customerId: req.customer._id,
      amount: totalAmount,
      currency: 'USD',
      status: 'created',
      intent: 'preorder',
      intentPayload: {
        preorderId: String(preorder._id),
        productId: String(product._id),
        productType,
        productModelType,
        productTitleRu,
        productTitleEn,
        name: String(name).trim().slice(0, 200),
        telegram: String(telegram).trim().slice(0, 100),
        desired_quantity: qty,
        comment: comment ? String(comment).trim().slice(0, 1000) : '',
        geo: geoCode,
        geoBreakdown: breakdown,
        unitPrice,
        totalAmount
      }
    });

    const cc = await requestCryptoCloudInvoice(invoiceDoc, req.customer, { ttlMinutes: 60 });
    if (!cc.ok) {
      await Preorder.findByIdAndDelete(preorder._id).catch(() => {});
      return res.status(502).json({ message: 'Failed to create payment invoice', details: cc.data });
    }

    const payLink = cc.result.link || '';
    await Preorder.findByIdAndUpdate(preorder._id, { $set: { payLink, ccInvoiceId: String(invoiceDoc._id) } }).catch(() => {});

    return res.status(201).json({
      orderId: invoiceDoc.orderId,
      uuid: cc.result.uuid,
      preorderUid: preorder.uid,
      amount: totalAmount,
      currency: 'USD',
      link: cc.result.link,
      expiry: cc.result.expiry_date
    });
  } catch (e) {
    err('checkoutPreorder error:', e.message);
    return res.status(400).json({ message: e.message || 'Checkout error' });
  }
};

export const listMyInvoices = async (req, res) => {
  try {
    const invoices = await CryptoCloudInvoice.find({ customerId: req.customer._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('orderId uuid amount currency status intent amountPaidUsd payLink paidAt createdAt');
    return res.json({ invoices });
  } catch (e) {
    console.error('[CryptoCloud] listMyInvoices error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

async function fulfillTopup(invoice, creditAmount) {
  const customer = await CustomerUser.findByIdAndUpdate(
    invoice.customerId,
    { $inc: { balance: creditAmount } },
    { returnDocument: 'after' }
  );

  const tx = await Transaction.create({
    userId: invoice.customerId,
    type: 'deposit_cash',
    status: 'success',
    amount: creditAmount,
    currency: 'USD',
    note: `CryptoCloud · ${invoice.orderId}${invoice.uuid ? ` · ${invoice.uuid}` : ''}`
  });
  invoice.transactionUid = tx.uid;

  if (customer) {
    io.of('/customer').to(`customer:${customer._id}`).emit('balance_updated', { balance: customer.balance });

    await notifyCustomer({
      customerId: customer._id,
      customer,
      type: 'balance_updated',
      title: { ru: 'Баланс пополнен', en: 'Balance topped up' },
      message: {
        ru: `Пополнение через CryptoCloud: +$${creditAmount.toFixed(2)}. Новый баланс: $${customer.balance.toFixed(2)}`,
        en: `CryptoCloud top-up: +$${creditAmount.toFixed(2)}. New balance: $${customer.balance.toFixed(2)}`
      },
      link: '/profile/wallet'
    });

    createAdminNotif({
      category: 'transaction',
      type: 'transaction_deposit',
      title: 'Пополнение баланса',
      message: `${customer.username || customer.email || customer._id} пополнил баланс через CryptoCloud — $${creditAmount.toFixed(2)} (${invoice.orderId})`,
      link: `/transactions?search=${encodeURIComponent(tx.uid)}`,
      meta: { customerId: customer._id, amount: creditAmount, orderId: invoice.orderId, uuid: invoice.uuid }
    });
  }
}

async function fulfillProductsOrCart(invoice) {
  const items = invoice.intentPayload?.items || [];
  const preCreatedOrderIds = invoice.intentPayload?.preCreatedOrderIds || [];
  if (!items.length) { warn('fulfillProductsOrCart: no items in payload', invoice.orderId); return; }

  const customer = await CustomerUser.findById(invoice.customerId);
  const createdOrders = [];

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const reservedIds = (it.reservedIds || []).map(id => new mongoose.Types.ObjectId(id));
    const totalAmount = parseFloat((it.unitPrice * it.quantity).toFixed(2));

    let order = null;
    const preCreatedId = preCreatedOrderIds[idx];
    if (preCreatedId && mongoose.isValidObjectId(preCreatedId)) {
      order = await Order.findByIdAndUpdate(
        preCreatedId,
        { $set: { status: 'delivered', paidAt: new Date(), deliveredAt: new Date(), payLink: '', analyzerCreditsGranted: true } },
        { returnDocument: 'after' }
      );
    }

    if (!order) {
      order = await Order.create({
        customerId: invoice.customerId,
        productId: it.productId,
        productType: it.productType,
        geo: it.geo,
        digitalItemId: reservedIds[0],
        digitalItemIds: reservedIds,
        quantity: it.quantity,
        productSnapshot: {
          title: it.titleRu,
          description: it.descStr,
          productType: it.productType,
          productSubType: it.productSubType || '',
          price: it.unitPrice,
          image: it.productImage || '',
          geo: it.geo
        },
        amount: totalAmount,
        currency: 'USD',
        paymentMethod: 'cryptocloud',
        status: 'delivered',
        paidAt: new Date(),
        deliveredAt: new Date(),
        // bonus analyzer scans are granted below — a later "delivered" status change must not grant them again
        analyzerCreditsGranted: true
      });
    }

    await DigitalItem.updateMany(
      { _id: { $in: reservedIds } },
      { $set: { status: 'sold', orderId: order._id } }
    );

    await Transaction.create({
      userId: invoice.customerId,
      type: 'order',
      status: 'success',
      amount: -totalAmount,
      currency: 'USD',
      note: `Order ${order.uid} x${it.quantity} (CryptoCloud ${invoice.orderId})`
    });

    await syncProductCounts(it.productId, it.productType);

    creditReferralReward({
      customerId: invoice.customerId,
      orderAmount: totalAmount,
      orderType: 'order',
      orderId: order._id,
      orderUid: order.uid,
      productType: it.productType
    }).catch(() => {});

    recordPurchase({
      customerId: invoice.customerId,
      amount: totalAmount,
      orderType: 'order',
      orderId: order._id,
      orderUid: order.uid,
      productType: it.productType
    }).catch(() => {});

    grantAnalyzerCredits({ customerId: invoice.customerId, qty: it.quantity, sourceType: 'order', sourceId: order._id }).catch(() => {});

    await notifyCustomer({
      customerId: invoice.customerId,
      type: 'order_delivered',
      title: { ru: 'Товар доставлен', en: 'Product delivered' },
      message: {
        ru: `Вы приобрели: ${it.titleRu}${it.quantity > 1 ? ` (x${it.quantity})` : ''}`,
        en: `You purchased: ${it.titleEn}${it.quantity > 1 ? ` (x${it.quantity})` : ''}`
      },
      link: `/profile/orders?search=${order.uid}`
    });

    createAdminNotif({
      category: 'order',
      type: 'order_product',
      title: 'Новая покупка (CryptoCloud)',
      message: `${customer?.username || customer?.email || invoice.customerId} купил: ${it.titleRu}${it.quantity > 1 ? ` (x${it.quantity})` : ''} — $${totalAmount.toFixed(2)}`,
      link: `/orders?search=${encodeURIComponent(order.uid)}`,
      meta: { customerId: invoice.customerId, orderId: order._id, amount: totalAmount, orderUid: order.uid, ccInvoice: invoice.orderId }
    });

    createdOrders.push(order.uid);
  }

  // mark invoice transactionUid with first one for reference
  if (createdOrders.length) invoice.transactionUid = createdOrders[0];
}

async function fulfillService(invoice) {
  const soId = invoice.intentPayload?.serviceOrderId;
  if (!soId) { warn('fulfillService: no serviceOrderId', invoice.orderId); return; }

  const order = await ServiceOrder.findById(soId);
  if (!order) { warn('fulfillService: ServiceOrder not found', soId); return; }
  if (order.paymentStatus === 'paid') return;

  const chargeAmount = parseFloat(Number(order.amountPaid) || 0);

  const tx = await Transaction.create({
    userId: invoice.customerId,
    type: 'service_order',
    status: 'success',
    amount: -chargeAmount,
    currency: 'USD',
    note: `Service ${order.uid} (CryptoCloud ${invoice.orderId})`
  });

  order.paymentStatus = 'paid';
  order.paymentTransactionUid = tx.uid;
  await order.save();

  creditReferralReward({
    customerId: invoice.customerId,
    orderAmount: chargeAmount,
    orderType: 'service_order',
    orderId: order._id,
    orderUid: order.uid
  }).catch(() => {});

  recordPurchase({
    customerId: invoice.customerId,
    amount: chargeAmount,
    orderType: 'service_order',
    orderId: order._id,
    orderUid: order.uid
  }).catch(() => {});

  grantAnalyzerCredits({ customerId: invoice.customerId, qty: 1, sourceType: 'service_order', sourceId: order._id }).catch(() => {});

  invoice.transactionUid = tx.uid;

  const customer = await CustomerUser.findById(invoice.customerId);
  const serviceTitle = order.serviceSnapshot?.title || String(order.serviceId);

  await notifyCustomer({
    customerId: invoice.customerId,
    customer,
    type: 'service_order_paid',
    title: { ru: 'Заявка на услугу оплачена', en: 'Service order paid' },
    message: {
      ru: `Заявка ${order.uid} оплачена через CryptoCloud`,
      en: `Order ${order.uid} paid via CryptoCloud`
    },
    link: `/profile/service-orders?search=${order.uid}`
  });

  createAdminNotif({
    category: 'order_service',
    type: 'order_service',
    title: 'Новая заявка на услугу (CryptoCloud)',
    message: `${customer?.username || customer?.email || invoice.customerId} оплатил заявку «${serviceTitle}» — ${order.uid} — $${chargeAmount.toFixed(2)}`,
    link: `/service-orders?search=${encodeURIComponent(order.uid)}`,
    meta: { orderId: order._id, uid: order.uid, amount: chargeAmount, ccInvoice: invoice.orderId }
  });
}

async function fulfillPreorder(invoice) {
  const p = invoice.intentPayload || {};
  if (!p.productId) { warn('fulfillPreorder: no productId', invoice.orderId); return; }

  const totalAmount = parseFloat(
    (Number(p.totalAmount) || (Number(p.unitPrice) * Number(p.desired_quantity))).toFixed(2)
  );

  let preorder = null;
  if (p.preorderId && mongoose.isValidObjectId(p.preorderId)) {
    preorder = await Preorder.findByIdAndUpdate(
      p.preorderId,
      { $set: { paymentStatus: 'paid', paymentMethod: 'cryptocloud', payLink: '' } },
      { returnDocument: 'after' }
    );
  }

  if (!preorder) {
    preorder = await Preorder.create({
      google_item_id: p.productType === 'google' ? p.productId : null,
      youtube_item_id: p.productType === 'youtube' ? p.productId : null,
      productType: p.productType,
      customerId: invoice.customerId,
      geo: p.geo,
      geoBreakdown: p.geoBreakdown || [],
      name: p.name,
      telegram: p.telegram,
      desired_quantity: p.desired_quantity,
      comment: p.comment || '',
      unitPriceSnapshot: p.unitPrice,
      amountPaid: totalAmount,
      currency: 'USD',
      paymentMethod: 'cryptocloud',
      paymentStatus: 'paid'
    });
  }

  const tx = await Transaction.create({
    userId: invoice.customerId,
    type: 'preorder',
    status: 'success',
    amount: -totalAmount,
    currency: 'USD',
    note: `Preorder ${preorder.uid} x${p.desired_quantity} (CryptoCloud ${invoice.orderId})`
  });
  await Preorder.updateOne({ _id: preorder._id }, { paymentTransactionUid: tx.uid });
  invoice.transactionUid = tx.uid;

  creditReferralReward({
    customerId: invoice.customerId,
    orderAmount: totalAmount,
    orderType: 'preorder',
    orderId: preorder._id,
    orderUid: preorder.uid,
    productType: p.productType === 'youtube' ? 'YoutubeProduct' : 'GoogleAdsProduct'
  }).catch(() => {});

  recordPurchase({
    customerId: invoice.customerId,
    amount: totalAmount,
    orderType: 'preorder',
    orderId: preorder._id,
    orderUid: preorder.uid,
    productType: p.productType === 'youtube' ? 'YoutubeProduct' : 'GoogleAdsProduct'
  }).catch(() => {});

  grantAnalyzerCredits({ customerId: invoice.customerId, qty: p.desired_quantity, sourceType: 'preorder', sourceId: preorder._id }).catch(() => {});

  const customer = await CustomerUser.findById(invoice.customerId);

  await notifyCustomer({
    customerId: invoice.customerId,
    customer,
    type: 'preorder_status',
    title: { ru: 'Предзаказ оплачен', en: 'Preorder paid' },
    message: {
      ru: `Предзаказ ${preorder.uid} оплачен через CryptoCloud`,
      en: `Preorder ${preorder.uid} paid via CryptoCloud`
    },
    link: `/profile/preorders?search=${preorder.uid}`
  });

  createAdminNotif({
    category: 'order_preorder',
    type: 'order_preorder',
    title: 'Новый предзаказ (CryptoCloud)',
    message: `${customer?.username || customer?.email || invoice.customerId} оплатил предзаказ «${p.productTitleRu}» (${p.desired_quantity} шт.) — ${preorder.uid} — $${totalAmount.toFixed(2)}`,
    link: `/preorders?search=${encodeURIComponent(preorder.uid)}`,
    meta: { preorderId: preorder._id, uid: preorder.uid, amount: totalAmount, ccInvoice: invoice.orderId }
  });
}

async function rollbackInvoice(invoice) {
  if (invoice.intent === 'product' || invoice.intent === 'cart') {
    const items = invoice.intentPayload?.items || [];
    const ids = items.flatMap(i => (i.reservedIds || []).map(id => new mongoose.Types.ObjectId(id)));
    await releaseReservations(ids);
    log('rollback: released reservations', { invoice: invoice.orderId, count: ids.length });
    const preCreatedOrderIds = invoice.intentPayload?.preCreatedOrderIds || [];
    if (preCreatedOrderIds.length) {
      await Order.updateMany(
        { _id: { $in: preCreatedOrderIds }, status: 'unpaid' },
        { $set: { status: 'cancelled', payLink: '' } }
      );
      log('rollback: cancelled pre-created orders', { count: preCreatedOrderIds.length });
    }
  } else if (invoice.intent === 'preorder') {
    const preorderId = invoice.intentPayload?.preorderId;
    if (preorderId && mongoose.isValidObjectId(preorderId)) {
      await Preorder.findOneAndUpdate(
        { _id: preorderId, paymentStatus: 'unpaid' },
        { $set: { status: 'cancelled', payLink: '' } }
      );
      log('rollback: cancelled pre-created preorder', preorderId);
    }
  } else if (invoice.intent === 'service') {
    const soId = invoice.intentPayload?.serviceOrderId;
    if (soId) {
      const so = await ServiceOrder.findById(soId);
      if (so && so.paymentStatus === 'pending_payment') {
        so.paymentStatus = 'cancelled';
        so.status = 'cancelled';
        so.payLink = '';
        await so.save();
        log('rollback: cancelled pending service order', soId);
      }
    }
  }
}

/**
 * Moves the invoice to a paid status atomically, from whatever non-paid status it has right now.
 * CryptoCloud delivers postbacks at least once: two copies arriving together both passed the
 * "already processed" check and fulfilled the order twice. Only the request whose conditional
 * update actually flips the status may fulfil. If the status changed under us (a parallel copy,
 * or the stale-invoice cron cancelling it), look again: paid → duplicate, anything else → retry.
 */
async function claimInvoicePaid(invoice, newStatus) {
  let from = invoice.status;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!from || PAID_STATUSES.has(from)) return false;
    const r = await CryptoCloudInvoice.updateOne({ _id: invoice._id, status: from }, { $set: { status: newStatus } });
    if (r.modifiedCount === 1) return true;
    from = (await CryptoCloudInvoice.findById(invoice._id).select('status').lean())?.status;
  }
  return false;
}

const appendPostbackLog = (invoiceId, entry) => CryptoCloudInvoice.updateOne(
  { _id: invoiceId },
  { $push: { postbackLog: { $each: [{ at: new Date(), source: 'postback', ...entry }], $slice: -POSTBACK_LOG_SIZE } } }
).catch((e) => err('postbackLog write failed:', e.message));

/**
 * The postback JWT is only `{ id, exp }` (HS256): it proves Trybit sent *something* about invoice `id`
 * recently, but the body is unsigned. So it only authorises the request; what the invoice actually is
 * comes from our own call to the Trybit API below.
 */
function verifyPostbackToken(token, invoiceId) {
  if (!token || token.length > MAX_TOKEN_LENGTH) return false;
  try {
    const decoded = jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
    if (typeof decoded?.exp !== 'number' || decoded.exp - Math.floor(Date.now() / 1000) > MAX_TOKEN_TTL_SEC) return false;
    return String(decoded.id ?? '').toUpperCase().replace(/^INV-/, '') === invoiceId;
  } catch {
    return false;
  }
}

async function fetchInvoiceInfo(uuid) {
  const r = await ccApi('/v2/invoice/merchant/info', { uuids: [uuid] });
  if (!r.ok || r.data?.status !== 'success' || !Array.isArray(r.data.result)) {
    throw new Error(`invoice info failed (http ${r.status})`);
  }
  return r.data.result.find((x) => String(x?.uuid || '').toUpperCase() === uuid) || null;
}

const toCents = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? NaN : Math.round(Number(v) * 100));

// Everything that must match before the invoice may be treated as ours. Empty list = consistent.
function invoiceInfoMismatches(info, invoice) {
  const problems = [];
  if (String(info.project?.id ?? '') !== String(getProjectId())) problems.push('project');
  if (String(info.order_id ?? '') !== invoice.orderId) problems.push('order_id');
  if (typeof info.test_mode !== 'boolean') problems.push('test_mode_missing');
  if (toCents(info.amount_usd) !== toCents(invoice.amount)) problems.push('amount');
  if (info.amount_in_fiat != null && toCents(info.amount_in_fiat) !== toCents(invoice.amount)) problems.push('amount_in_fiat');
  if ((invoice.currency || 'USD') !== 'USD' || (info.fiat_currency != null && String(info.fiat_currency).toUpperCase() !== 'USD')) problems.push('currency');
  return problems;
}

function reportAnomaly(invoice, reason, details) {
  err('SECURITY anomaly', { orderId: invoice.orderId, uuid: invoice.uuid, intent: invoice.intent, reason, ...details });
  const payload = { orderId: invoice.orderId, uuid: invoice.uuid, intent: invoice.intent, customerId: invoice.customerId, amount: invoice.amount, reason, ...details };
  try { io.of('/admin').to('admins').emit('topup-anomaly', payload); } catch { /* socket layer down */ }
  createAdminNotif({
    category: 'transaction',
    type: 'topup_anomaly',
    title: 'Подозрительное уведомление об оплате',
    message: `CryptoCloud ${invoice.orderId} (${invoice.uuid}): ${reason}. Зачисление не выполнено — проверьте счёт вручную.`,
    link: null,
    meta: payload
  });
}

export const handlePostback = async (req, res) => {
  const ip = String(req.ip || req.socket?.remoteAddress || '');
  const unauthorized = () => res.status(401).json({ message: 'Unauthorized' });
  try {
    const body = req.body || {};
    const invoiceId = String(body.invoice_id ?? '').trim().toUpperCase().replace(/^INV-/, '');
    if (!INVOICE_ID_RE.test(invoiceId)) return res.status(400).json({ message: 'Invalid invoice_id' });

    if (!getSecret() || !getApiKey() || !getProjectId()) {
      err('postback REJECTED: CRYPTOCLOUD_SECRET / CRYPTOCLOUD_API_KEY / CRYPTOCLOUD_PROJECT_ID not configured');
      return res.status(500).json({ message: 'Server misconfigured' });
    }

    if (!verifyPostbackToken(typeof body.token === 'string' ? body.token.trim() : '', invoiceId)) {
      warn('postback REJECTED: bad token', { ip, invoiceId });
      return unauthorized();
    }

    const uuid = `INV-${invoiceId}`;
    const invoice = await CryptoCloudInvoice.findOne({ uuid: { $in: [uuid, invoiceId] } });
    if (!invoice) {
      err('postback: invoice not found', { invoiceId });
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const { token: _omit, ...safeBody } = body;
    const journal = (result, status) => appendPostbackLog(invoice._id, { ip, result, status: status || '' });

    if (PAID_STATUSES.has(invoice.status)) {
      log('postback: already processed', { orderId: invoice.orderId });
      await journal('already_processed', invoice.status);
      return res.status(200).json({ message: 'Already processed' });
    }

    let info;
    try {
      info = await fetchInvoiceInfo(uuid);
    } catch (e) {
      err('postback: could not verify invoice with the API', { orderId: invoice.orderId, reason: e.message });
      await journal('api_error');
      return res.status(502).json({ message: 'Verification unavailable, retry later' });
    }
    if (!info) {
      reportAnomaly(invoice, 'invoice not returned by API', { ip });
      await journal('anomaly_not_found');
      return res.status(200).json({ message: 'Ignored' });
    }

    const apiStatus = String(info.status || '').toLowerCase();
    const mismatches = invoiceInfoMismatches(info, invoice);
    if (mismatches.length) {
      reportAnomaly(invoice, `mismatch: ${mismatches.join(', ')}`, {
        ip, apiStatus, apiProject: info.project?.id, apiOrderId: info.order_id, apiAmountUsd: info.amount_usd
      });
      await journal(`anomaly_${mismatches.join('_')}`, apiStatus);
      return res.status(200).json({ message: 'Ignored' });
    }

    if (info.test_mode !== false) {
      warn('postback: test-mode invoice ignored', { orderId: invoice.orderId });
      await journal('test_mode_ignored', apiStatus);
      return res.status(200).json({ message: 'Test payment ignored' });
    }

    if (PAID_STATUSES.has(apiStatus) && String(info.invoice_status || '').toLowerCase() === 'success') {
      if (!(await claimInvoicePaid(invoice, apiStatus))) {
        log('postback: duplicate — a parallel postback already took this payment', { orderId: invoice.orderId });
        await journal('duplicate', apiStatus);
        return res.status(200).json({ message: 'Already processed' });
      }

      invoice.status = apiStatus;
      invoice.rawPostback = safeBody;
      invoice.amountPaidUsd = Number(info.amount_paid_usd) || 0;
      invoice.paidAt = new Date();
      log('postback: paid', { intent: invoice.intent, orderId: invoice.orderId, apiStatus });
      let result = 'fulfilled';
      try {
        // Only the amount we invoiced is credited: amount_paid_usd also includes the gateway fee paid by the client.
        if (invoice.intent === 'topup') await fulfillTopup(invoice, parseFloat(Number(invoice.amount).toFixed(2)));
        else if (invoice.intent === 'product' || invoice.intent === 'cart') await fulfillProductsOrCart(invoice);
        else if (invoice.intent === 'service') await fulfillService(invoice);
        else if (invoice.intent === 'preorder') await fulfillPreorder(invoice);
        invoice.fulfilledAt = new Date();
      } catch (e) {
        result = 'fulfillment_error';
        err('fulfillment error:', e);
      }
      await invoice.save();
      await journal(result, apiStatus);
      return res.status(200).json({ message: 'Postback received', orderId: invoice.orderId, status: invoice.status });
    }

    if (apiStatus === 'canceled' || apiStatus === 'partial') {
      const r = await CryptoCloudInvoice.updateOne(
        // a second "canceled" must not roll back again: the released items may already be reserved by someone else
        { _id: invoice._id, status: { $nin: [...PAID_STATUSES, apiStatus] } },
        { $set: { status: apiStatus, rawPostback: safeBody, amountPaidUsd: Number(info.amount_paid_usd) || 0 } }
      );
      if (apiStatus === 'canceled' && r.modifiedCount === 1) await rollbackInvoice(invoice);
      await journal(apiStatus, apiStatus);
      return res.status(200).json({ message: 'Postback received', orderId: invoice.orderId, status: apiStatus });
    }

    await journal('no_change', apiStatus);
    return res.status(200).json({ message: 'Postback received', orderId: invoice.orderId, status: invoice.status });
  } catch (e) {
    err('handlePostback error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const debugPing = async (req, res) => {
  return res.json({
    ok: true,
    time: new Date().toISOString(),
    configured: { apiKey: !!getApiKey(), shopId: !!getShopId(), secret: !!getSecret(), projectId: !!getProjectId(), apiUrl: getApiUrl() },
    endpoints: {
      topup: 'POST /api/v3/cryptocloud/topup (auth)',
      checkoutProduct: 'POST /api/v3/cryptocloud/checkout/product (auth)',
      checkoutCart: 'POST /api/v3/cryptocloud/checkout/cart (auth)',
      checkoutService: 'POST /api/v3/cryptocloud/checkout/service (auth, multipart)',
      checkoutPreorder: 'POST /api/v3/cryptocloud/checkout/preorder (auth)',
      myInvoices: 'GET /api/v3/cryptocloud/my-invoices (auth)',
      postback: 'POST /api/v3/cryptocloud/postback (public)',
      ping: 'GET /api/v3/cryptocloud/ping (public)'
    }
  });
};
