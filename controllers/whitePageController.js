import crypto from 'crypto';
import WhitePageOrder from '../models/WhitePageOrder.js';
import CustomerUser from '../models/CustomerUser.js';
import Transaction from '../models/Transaction.js';
import { wpGet, wpPost, wpDownloadOrigin, WpApiError } from '../utils/wpApiClient.js';
import { io } from '../server.js';
import { createAdminNotif } from './adminNotifController.js';

const ALLOWED_TYPES = ['landing-page', 'blog'];

function sendWpError(res, err, fallbackMessage) {
  if (err instanceof WpApiError) {
    return res.status(err.status).json({ message: err.message || fallbackMessage, code: err.code, errors: err.errors });
  }
  console.error('[WhitePages]', err);
  return res.status(500).json({ message: fallbackMessage || 'Server error' });
}

function sanitizeStr(v, max) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return s.slice(0, max);
}

function buildGeneratePayload(body) {
  const payload = {
    type: ALLOWED_TYPES.includes(body.type) ? body.type : 'landing-page',
    frame: 'html'
  };
  const theme = sanitizeStr(body.theme, 40);
  if (theme) payload.theme = theme;
  const prompt = sanitizeStr(body.prompt, 2000);
  if (prompt) payload.prompt = prompt;
  const geo = sanitizeStr(body.geo, 5);
  if (geo) payload.geo = geo.toUpperCase();
  const language = sanitizeStr(body.language, 10);
  if (language) payload.language = language;
  const companyName = sanitizeStr(body.companyName, 200);
  if (companyName) payload.companyName = companyName;
  const domainName = sanitizeStr(body.domainName, 253);
  if (domainName) payload.domainName = domainName;
  const phone = sanitizeStr(body.phone, 30);
  if (phone) payload.phone = phone;
  const email = sanitizeStr(body.email, 254);
  if (email) payload.email = email;
  const address = sanitizeStr(body.address, 500);
  if (address) payload.address = address;
  const fbPixel = sanitizeStr(body.fbPixel, 50);
  if (fbPixel) payload.fbPixel = fbPixel.replace(/\D/g, '');
  const googleAdsTag = sanitizeStr(body.googleAdsTag, 50);
  if (googleAdsTag) payload.googleAdsTag = googleAdsTag;
  const financeLicense = sanitizeStr(body.financeLicense, 100);
  if (financeLicense) payload.financeLicense = financeLicense;
  const stopwords = sanitizeStr(body.stopwords, 4000);
  if (stopwords) payload.stopwords = stopwords;
  const keywords = sanitizeStr(body.keywords, 800);
  if (keywords) payload.keywords = keywords;
  const note = sanitizeStr(body.note, 50);
  if (note) payload.note = note;
  const archiveLabel = sanitizeStr(body.archiveLabel, 80);
  if (archiveLabel) payload.archiveLabel = archiveLabel;
  return payload;
}

export const getPrice = async (req, res) => {
  try {
    const customer = req.customer;
    const type = ALLOWED_TYPES.includes(req.query.type) ? req.query.type : 'landing-page';
    const frame = req.query.frame || 'html';
    const data = await wpGet('/price', {
      externalUserId: customer.uid,
      query: { framework: frame, type }
    });
    return res.json({ price: data.price, framework: data.framework, type: data.type });
  } catch (err) {
    return sendWpError(res, err, 'Failed to fetch price');
  }
};

export const createWhitePage = async (req, res) => {
  const customer = req.customer;
  try {
    const payload = buildGeneratePayload(req.body || {});
    if (!ALLOWED_TYPES.includes(payload.type)) {
      return res.status(400).json({ message: 'Invalid page type' });
    }

    const preCustomer = await CustomerUser.findById(customer._id).select('balance uid');
    if (!preCustomer) return res.status(404).json({ message: 'User not found' });

    let priceData;
    try {
      priceData = await wpGet('/price', {
        externalUserId: preCustomer.uid,
        query: { framework: payload.frame, type: payload.type }
      });
    } catch (err) {
      return sendWpError(res, err, 'Failed to fetch price');
    }

    const chargeAmount = parseFloat(Number(priceData.price) || 0);
    if (chargeAmount <= 0) {
      return res.status(400).json({ message: 'Price is not configured' });
    }
    if ((preCustomer.balance || 0) < chargeAmount) {
      return res.status(402).json({ message: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' });
    }

    try {
      await wpPost('/balance/sync', {
        externalUserId: preCustomer.uid,
        body: { balance: preCustomer.balance }
      });
    } catch (err) {
      return sendWpError(res, err, 'Failed to sync balance');
    }

    let taskData;
    try {
      taskData = await wpPost('/generate', {
        externalUserId: preCustomer.uid,
        body: payload,
        idempotencyKey: crypto.randomUUID()
      });
    } catch (err) {
      return sendWpError(res, err, 'Failed to start generation');
    }

    const task = taskData.task || taskData;

    const updatedCustomer = await CustomerUser.findOneAndUpdate(
      { _id: customer._id, balance: { $gte: chargeAmount } },
      { $inc: { balance: -chargeAmount } },
      { returnDocument: 'after' }
    );

    if (!updatedCustomer) {
      console.error('[WhitePages] balance desync: local debit failed after external generate for', preCustomer.uid);
    }

    let order;
    try {
      order = await WhitePageOrder.create({
        customerId: customer._id,
        uniqueId: task.uniqueId,
        type: payload.type,
        frame: payload.frame,
        theme: payload.theme || '',
        geo: payload.geo || '',
        language: payload.language || '',
        prompt: payload.prompt || '',
        companyName: payload.companyName || '',
        domainName: payload.domainName || '',
        phone: payload.phone || '',
        email: payload.email || '',
        address: payload.address || '',
        financeLicense: payload.financeLicense || '',
        fbPixel: payload.fbPixel || '',
        googleAdsTag: payload.googleAdsTag || '',
        stopwords: payload.stopwords || '',
        keywords: payload.keywords || '',
        note: payload.note || '',
        archiveLabel: payload.archiveLabel || '',
        price: chargeAmount,
        status: task.status === 'completed' || task.status === 'failed' ? task.status : 'on-generate'
      });
    } catch (err) {
      console.error('[WhitePages] failed to persist local order', err);
    }

    if (updatedCustomer) {
      await Transaction.create({
        userId: customer._id,
        type: 'white_page_order',
        status: 'success',
        amount: -chargeAmount,
        currency: 'USD',
        note: `White page ${task.uniqueId}`
      });

      io.of('/customer').to(`customer:${String(customer._id)}`).emit('balance_updated', {
        balance: updatedCustomer.balance,
        bonusBalance: updatedCustomer.bonusBalance
      });
    }

    createAdminNotif({
      category: 'white_page_order',
      type: 'white_page_order',
      title: 'Новый заказ White Page',
      message: `Заказана генерация White Page — ${task.uniqueId} — $${chargeAmount.toFixed(2)}`,
      link: `/service-orders?search=${encodeURIComponent(task.uniqueId)}`,
      meta: { uniqueId: task.uniqueId, amount: chargeAmount }
    });

    return res.status(201).json({
      task,
      order,
      balance: updatedCustomer ? updatedCustomer.balance : preCustomer.balance
    });
  } catch (err) {
    console.error('[WhitePages] createWhitePage error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

export const getMyWhitePages = async (req, res) => {
  try {
    const customer = req.customer;
    const { page = 1, limit = 10, search = '' } = req.query;
    const query = { customerId: customer._id };
    if (search) {
      const safe = String(search).slice(0, 100);
      query.$or = [
        { uniqueId: { $regex: safe, $options: 'i' } },
        { archiveLabel: { $regex: safe, $options: 'i' } },
        { note: { $regex: safe, $options: 'i' } },
        { prompt: { $regex: safe, $options: 'i' } }
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [orders, total] = await Promise.all([
      WhitePageOrder.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      WhitePageOrder.countDocuments(query)
    ]);

    const pending = orders.filter(o => o.status === 'on-generate').slice(0, 5);
    await Promise.all(pending.map(async (o) => {
      try {
        const data = await wpGet(`/history/${o.uniqueId}`, { externalUserId: customer.uid });
        const task = data.task || data;
        if (task.status && task.status !== o.status) {
          o.status = task.status;
          await o.save();
        }
      } catch {}
    }));

    return res.json({ orders, total, pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    console.error('[WhitePages] getMyWhitePages error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getWhitePageDetail = async (req, res) => {
  try {
    const customer = req.customer;
    const order = await WhitePageOrder.findOne({ uniqueId: req.params.uniqueId, customerId: customer._id });
    if (!order) return res.status(404).json({ message: 'Task not found' });

    try {
      const data = await wpGet(`/history/${order.uniqueId}`, { externalUserId: customer.uid });
      const task = data.task || data;
      if (task.status && task.status !== order.status) {
        order.status = task.status;
        await order.save();
      }
      return res.json({ order, task });
    } catch (err) {
      return res.json({ order, task: null });
    }
  } catch (err) {
    console.error('[WhitePages] getWhitePageDetail error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const mintWhitePageDownload = async (req, res) => {
  try {
    const customer = req.customer;
    const order = await WhitePageOrder.findOne({ uniqueId: req.params.uniqueId, customerId: customer._id });
    if (!order) return res.status(404).json({ message: 'Task not found' });
    if (order.status !== 'completed') {
      return res.status(400).json({ message: 'File is available only for completed tasks' });
    }

    const data = await wpPost(`/history/${order.uniqueId}/mint-download`, { externalUserId: customer.uid });
    const origin = wpDownloadOrigin();
    const downloadUrl = data.downloadUrl?.startsWith('http') ? data.downloadUrl : `${origin}${data.downloadUrl}`;
    return res.json({ downloadUrl });
  } catch (err) {
    return sendWpError(res, err, 'Failed to mint download link');
  }
};

export const regenerateWhitePage = async (req, res) => {
  try {
    const customer = req.customer;
    const order = await WhitePageOrder.findOne({ uniqueId: req.params.uniqueId, customerId: customer._id });
    if (!order) return res.status(404).json({ message: 'Task not found' });

    const data = await wpPost(`/history/${order.uniqueId}/regenerate`, { externalUserId: customer.uid });
    const task = data.task || data;
    order.regenUsed = true;
    order.status = task?.status && task.status !== order.status ? task.status : 'on-generate';
    await order.save();

    return res.json({ order, task: task || null });
  } catch (err) {
    return sendWpError(res, err, 'Failed to regenerate');
  }
};

export const retryWhitePage = async (req, res) => {
  try {
    const customer = req.customer;
    const order = await WhitePageOrder.findOne({ uniqueId: req.params.uniqueId, customerId: customer._id });
    if (!order) return res.status(404).json({ message: 'Task not found' });

    const data = await wpPost(`/history/${order.uniqueId}/retry`, { externalUserId: customer.uid });
    const task = data.task || data;
    order.status = task?.status && task.status !== order.status ? task.status : 'on-generate';
    order.lastError = '';
    await order.save();

    return res.json({ order, task: task || null });
  } catch (err) {
    return sendWpError(res, err, 'Failed to retry');
  }
};
