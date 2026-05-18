import jwt from 'jsonwebtoken';
import CryptoCloudInvoice from '../models/CryptoCloudInvoice.js';
import CustomerUser from '../models/CustomerUser.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';
import { io } from '../server.js';
import { createAdminNotif } from './adminNotifController.js';

const getApiUrl = () => process.env.CRYPTOCLOUD_API_URL || 'https://api.cryptocloud.plus';
const getApiKey = () => process.env.CRYPTOCLOUD_API_KEY;
const getShopId = () => process.env.CRYPTOCLOUD_SHOP_ID;
const getSecret = () => process.env.CRYPTOCLOUD_SECRET;

const PAID_STATUSES = new Set(['paid', 'overpaid', 'partial']);

const isDebug = () => process.env.CRYPTOCLOUD_DEBUG !== '0';
const log = (...args) => { if (isDebug()) console.log('[CryptoCloud]', ...args); };
const warn = (...args) => console.warn('[CryptoCloud]', ...args);
const err = (...args) => console.error('[CryptoCloud]', ...args);

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
      status: 'created'
    });

    log('createTopupInvoice: db invoice created', {
      orderId: invoiceDoc.orderId,
      customerId: String(customer._id),
      email: customer.email,
      amount: roundedAmount
    });

    const body = {
      shop_id: getShopId(),
      amount: roundedAmount,
      currency: 'USD',
      order_id: invoiceDoc.orderId,
      email: customer.email || undefined,
      add_fields: {
        time_to_pay: { hours: 1, minutes: 0 }
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
    log('createTopupInvoice: CC response', { http: ccRes.status, status: ccData?.status, hasLink: !!ccData?.result?.link });
    if (!ccRes.ok || ccData?.status !== 'success' || !ccData?.result?.link) {
      await CryptoCloudInvoice.updateOne(
        { _id: invoiceDoc._id },
        { $set: { status: 'failed', rawResponse: ccData } }
      );
      err('create invoice failed:', JSON.stringify(ccData));
      return res.status(502).json({ message: 'Failed to create payment invoice', details: ccData });
    }

    const result = ccData.result;
    log('createTopupInvoice: invoice ready', { uuid: result.uuid, link: result.link, expiry: result.expiry_date });
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

    return res.status(201).json({
      orderId: invoiceDoc.orderId,
      uuid: result.uuid,
      amount: roundedAmount,
      currency: 'USD',
      link: result.link,
      expiry: result.expiry_date
    });
  } catch (e) {
    err('createTopupInvoice error:', e);
    return res.status(500).json({ message: 'Server error', error: e?.message });
  }
};

export const listMyInvoices = async (req, res) => {
  try {
    const invoices = await CryptoCloudInvoice.find({ customerId: req.customer._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('orderId uuid amount currency status amountPaidUsd payLink paidAt createdAt');
    return res.json({ invoices });
  } catch (e) {
    console.error('[CryptoCloud] listMyInvoices error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const handlePostback = async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress;
  const ct = req.headers['content-type'] || '';
  try {
    const body = req.body || {};
    log('postback received', {
      ip,
      contentType: ct,
      keys: Object.keys(body),
      status: body.status,
      invoice_id: body.invoice_id,
      order_id: body.order_id,
      currency: body.currency,
      amount_crypto: body.amount_crypto,
      hasToken: !!body.token,
      bodySize: JSON.stringify(body).length
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
      err('postback REJECTED: CRYPTOCLOUD_SECRET is not configured on the server');
      return res.status(500).json({ message: 'Server misconfigured: secret missing' });
    }
    if (!token) {
      err('postback REJECTED: missing JWT token in payload', { ip, invoiceId, orderId });
      return res.status(401).json({ message: 'Missing signature token' });
    }
    let decoded;
    try {
      decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
      log('postback: JWT verified', decoded);
    } catch (e) {
      err('postback REJECTED: JWT invalid', { ip, invoiceId, orderId, reason: e.message });
      return res.status(401).json({ message: 'Invalid signature' });
    }

    // Optional payload binding: if JWT carries id/invoice_id, ensure it matches the body
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
    log('postback: invoice matched', { dbId: String(invoice._id), orderId: invoice.orderId, currentStatus: invoice.status, customerId: String(invoice.customerId) });

    if (invoice.status === 'paid' || invoice.status === 'overpaid' || invoice.status === 'partial') {
      log('postback: already processed, skipping', { orderId: invoice.orderId, status: invoice.status });
      return res.status(200).json({ message: 'Already processed' });
    }

    const newStatus = ['paid', 'overpaid', 'partial', 'canceled'].includes(innerStatus)
      ? innerStatus
      : (status === 'success' ? 'paid' : invoice.status);

    invoice.status = newStatus;
    invoice.rawPostback = body;
    if (amountPaidUsd > 0) invoice.amountPaidUsd = amountPaidUsd;

    log('postback: status decision', { innerStatus, topStatus: status, newStatus, amountPaidUsd });

    if (PAID_STATUSES.has(newStatus)) {
      const creditAmount = parseFloat((amountPaidUsd > 0 ? amountPaidUsd : invoice.amount).toFixed(2));
      invoice.paidAt = new Date();
      log('postback: crediting balance', { customerId: String(invoice.customerId), creditAmount });

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
      await invoice.save();
      log('postback: transaction created', { txUid: tx.uid, newBalance: customer?.balance });

      if (customer) {
        io.of('/customer').to(`customer:${customer._id}`).emit('balance_updated', {
          balance: customer.balance
        });

        const notif = await Notification.create({
          userId: customer._id,
          type: 'balance_updated',
          title: { ru: 'Баланс пополнен', en: 'Balance topped up' },
          message: {
            ru: `Пополнение через CryptoCloud: +$${creditAmount.toFixed(2)}`,
            en: `CryptoCloud top-up: +$${creditAmount.toFixed(2)}`
          },
          link: '/profile/wallet'
        });

        io.of('/customer').to(`customer:${customer._id}`).emit('notification', {
          id: notif._id,
          type: notif.type,
          title: notif.title,
          message: notif.message,
          link: notif.link,
          createdAt: notif.createdAt
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
    } else {
      await invoice.save();
      log('postback: non-paid status saved', { orderId: invoice.orderId, status: newStatus });
    }

    return res.status(200).json({ message: 'Postback received', orderId: invoice.orderId, status: invoice.status });
  } catch (e) {
    err('handlePostback error:', e);
    return res.status(500).json({ message: 'Server error', error: e?.message });
  }
};

export const debugPing = async (req, res) => {
  log('debugPing called', { ip: req.headers['x-forwarded-for'] || req.ip, ua: req.headers['user-agent'] });
  return res.json({
    ok: true,
    time: new Date().toISOString(),
    configured: { apiKey: !!getApiKey(), shopId: !!getShopId(), secret: !!getSecret(), apiUrl: getApiUrl() },
    endpoints: {
      topup: 'POST /api/v3/cryptocloud/topup (auth)',
      myInvoices: 'GET /api/v3/cryptocloud/my-invoices (auth)',
      postback: 'POST /api/v3/cryptocloud/postback (public)',
      ping: 'GET /api/v3/cryptocloud/ping (public)'
    }
  });
};
