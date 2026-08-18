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

const PAID_STATUSES = new Set(['paid', 'overpaid', 'partial']);
const FAILED_STATUSES = new Set(['canceled', 'failed']);

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

  const ccRes = await fetch(`${getApiUrl()}/v2/invoice/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token ${getApiKey()}`
    },
    body: JSON.stringify(body)
  });

  const ccData = await ccRes.json().catch(() => ({}));
  log('CC invoice', invoiceDoc.intent, { http: ccRes.status, status: ccData?.status, link: !!ccData?.result?.link });

  if (!ccRes.ok || ccData?.status !== 'success' || !ccData?.result?.link) {
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
        { $set: { status: 'delivered', paidAt: new Date(), deliveredAt: new Date(), payLink: '' } },
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
        deliveredAt: new Date()
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

    grantAnalyzerCredits({ customerId: invoice.customerId, qty: it.quantity }).catch(() => {});

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

  grantAnalyzerCredits({ customerId: invoice.customerId, qty: 1 }).catch(() => {});

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

  grantAnalyzerCredits({ customerId: invoice.customerId, qty: p.desired_quantity }).catch(() => {});

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

export const handlePostback = async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress;
  const ct = req.headers['content-type'] || '';
  try {
    const body = req.body || {};
    log('postback received', {
      ip, contentType: ct, keys: Object.keys(body),
      status: body.status, invoice_id: body.invoice_id, order_id: body.order_id,
      hasToken: !!body.token
    });

    const status = String(body.status || '');
    const invoiceId = String(body.invoice_id || '');
    const orderId = body.order_id ? String(body.order_id) : '';
    const token = body.token ? String(body.token) : '';

    if (!invoiceId && !orderId) {
      warn('postback: missing invoice_id and order_id', body);
      return res.status(400).json({ message: 'invoice_id or order_id is required' });
    }

    const secret = getSecret();
    if (!secret) {
      err('postback REJECTED: CRYPTOCLOUD_SECRET is not configured');
      return res.status(500).json({ message: 'Server misconfigured: secret missing' });
    }
    if (!token) {
      err('postback REJECTED: missing JWT token', { ip, invoiceId, orderId });
      return res.status(401).json({ message: 'Missing signature token' });
    }
    let decoded;
    try {
      decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch (e) {
      err('postback REJECTED: JWT invalid', { ip, invoiceId, orderId, reason: e.message });
      return res.status(401).json({ message: 'Invalid signature' });
    }

    const tokenInvoiceId = decoded?.id != null ? String(decoded.id) : (decoded?.invoice_id != null ? String(decoded.invoice_id) : '');
    if (tokenInvoiceId && invoiceId && tokenInvoiceId !== invoiceId && tokenInvoiceId !== `INV-${invoiceId}`) {
      err('postback REJECTED: token invoice id mismatch', { tokenInvoiceId, invoiceId });
      return res.status(401).json({ message: 'Token does not match invoice' });
    }

    const invoiceInfo = (typeof body.invoice_info === 'object' && body.invoice_info) || {};
    const innerStatus = String(invoiceInfo.status || status || '').toLowerCase();
    const amountPaidUsd = Number(invoiceInfo.amount_paid_usd ?? invoiceInfo.amount_in_fiat ?? 0) || 0;

    const query = orderId
      ? { orderId }
      : { uuid: { $in: [invoiceId, `INV-${invoiceId}`] } };

    const invoice = await CryptoCloudInvoice.findOne(query);
    if (!invoice) {
      err('postback: invoice not found', { invoiceId, orderId });
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (invoice.status === 'paid' || invoice.status === 'overpaid' || invoice.status === 'partial') {
      log('postback: already processed', { orderId: invoice.orderId });
      return res.status(200).json({ message: 'Already processed' });
    }

    const newStatus = ['paid', 'overpaid', 'partial', 'canceled'].includes(innerStatus)
      ? innerStatus
      : (status === 'success' ? 'paid' : invoice.status);

    invoice.status = newStatus;
    invoice.rawPostback = body;
    if (amountPaidUsd > 0) invoice.amountPaidUsd = amountPaidUsd;

    log('postback: decision', { intent: invoice.intent, newStatus, amountPaidUsd });

    if (PAID_STATUSES.has(newStatus)) {
      invoice.paidAt = new Date();
      try {
        if (invoice.intent === 'topup') {
          const creditAmount = parseFloat((amountPaidUsd > 0 ? amountPaidUsd : invoice.amount).toFixed(2));
          await fulfillTopup(invoice, creditAmount);
        } else if (invoice.intent === 'product' || invoice.intent === 'cart') {
          await fulfillProductsOrCart(invoice);
        } else if (invoice.intent === 'service') {
          await fulfillService(invoice);
        } else if (invoice.intent === 'preorder') {
          await fulfillPreorder(invoice);
        }
        invoice.fulfilledAt = new Date();
      } catch (e) {
        err('fulfillment error:', e);
      }
      await invoice.save();
    } else if (FAILED_STATUSES.has(newStatus)) {
      await invoice.save();
      await rollbackInvoice(invoice);
    } else {
      await invoice.save();
    }

    return res.status(200).json({ message: 'Postback received', orderId: invoice.orderId, status: invoice.status });
  } catch (e) {
    err('handlePostback error:', e);
    return res.status(500).json({ message: 'Server error', error: e?.message });
  }
};

export const debugPing = async (req, res) => {
  return res.json({
    ok: true,
    time: new Date().toISOString(),
    configured: { apiKey: !!getApiKey(), shopId: !!getShopId(), secret: !!getSecret(), apiUrl: getApiUrl() },
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
