import Order from '../models/Order.js';
import DigitalItem from '../models/DigitalItem.js';
import ReplaceRequest from '../models/ReplaceRequest.js';
import CustomerUser from '../models/CustomerUser.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';
import { io } from '../server.js';
import { createAdminNotif } from './adminNotifController.js';
import { clawbackReferralReward } from '../utils/referral.js';
import path from 'path';
import {
  bunnyUpload,
  bunnyDownload,
  generateFilename,
  getBunnyPublicUrl,
  isBunnyPath,
  isBunnyCdnUrl
} from '../utils/bunnyStorage.js';
import { deleteAnyFile } from '../utils/deleteFile.js';

const deleteReplacePhoto = (photo) => {
  deleteAnyFile(photo);
};

export const submitReplaceRequest = async (req, res) => {
  try {
    const { uid } = req.params;
    const customerId = req.customer._id;
    const { reason } = req.body;

    if (!reason || String(reason).trim().length < 5) {
      return res.status(400).json({ message: 'Укажите причину (минимум 5 символов)' });
    }

    const order = await Order.findOne({ uid, customerId });
    if (!order) return res.status(404).json({ message: 'Заказ не найден' });

    if (order.status !== 'delivered') {
      return res.status(400).json({ message: 'Замену можно запросить только для доставленного заказа' });
    }

    const existing = await ReplaceRequest.findOne({ orderId: order._id });
    if (existing) {
      return res.status(400).json({ message: 'Заявка на замену уже подана' });
    }

    const photos = [];
    const cdnBase = (process.env.BUNNY_CDN_URL || '').replace(/\/$/, '');
    for (const file of (req.files || [])) {
      const filename = generateFilename(file.originalname);
      const remotePath = `/replacement-proofs/${filename}`;
      await bunnyUpload(remotePath, file.buffer, file.mimetype);
      const publicUrl = getBunnyPublicUrl(remotePath);
      if (!cdnBase || !/^https?:\/\//i.test(publicUrl)) {
        console.error('[Replace] BUNNY_CDN_URL не задан — не могу сохранить публичную ссылку на фото');
        return res.status(500).json({ message: 'Конфигурация CDN не настроена' });
      }
      photos.push(publicUrl);
    }

    await ReplaceRequest.create({
      orderId: order._id,
      customerId,
      reason: String(reason).trim().slice(0, 2000),
      photos
    });

    order.status = 'waiting_replacement';
    await order.save();

    createAdminNotif({
      category: 'replacement',
      type: 'replace_request',
      title: 'Запрос на замену',
      message: `Заявка на замену по заказу ${order.uid}`,
      link: `/orders?search=${encodeURIComponent(order.uid)}`,
      meta: { orderId: order._id, orderUid: order.uid }
    });

    return res.status(201).json({ message: 'Заявка отправлена' });
  } catch (error) {
    console.error('[Replace] submitReplaceRequest error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const downloadReplaceRequestPhoto = async (req, res) => {
  try {
    const orderId = req.params.id;
    const idx = parseInt(req.params.photoIndex, 10);
    if (Number.isNaN(idx) || idx < 0) {
      return res.status(400).json({ message: 'Некорректный индекс фото' });
    }

    const request = await ReplaceRequest.findOne({ orderId }).lean();
    if (!request?.photos?.length || idx >= request.photos.length) {
      return res.status(404).json({ message: 'Фото не найдено' });
    }

    const photoRef = request.photos[idx];
    if (!photoRef) {
      return res.status(404).json({ message: 'Фото не найдено' });
    }

    const s = String(photoRef);
    if (/^https?:\/\//i.test(s) || isBunnyCdnUrl(s)) {
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.redirect(302, s);
    }

    if (!s.startsWith('/replace-requests/')) {
      return res.status(404).json({ message: 'Фото не найдено' });
    }

    const ext = path.extname(s).toLowerCase();
    const mime =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    if (isBunnyPath(s)) {
      const { stream, length } = await bunnyDownload(s);
      if (length) res.setHeader('Content-Length', String(length));
      return stream.pipe(res);
    }

    return res.status(404).json({ message: 'Файл недоступен' });
  } catch (error) {
    console.error('[Replace] downloadReplaceRequestPhoto error:', error);
    if (!res.headersSent) return res.status(500).json({ message: 'Server error' });
  }
};

export const getMyReplaceRequest = async (req, res) => {
  try {
    const order = await Order.findOne({ uid: req.params.uid, customerId: req.customer._id });
    if (!order) return res.status(404).json({ message: 'Заказ не найден' });

    const request = await ReplaceRequest.findOne({ orderId: order._id });
    if (!request) return res.status(404).json({ message: 'Заявка не найдена' });

    return res.status(200).json({ request });
  } catch (error) {
    console.error('[Replace] getMyReplaceRequest error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getOrderReplaceRequest = async (req, res) => {
  try {
    const request = await ReplaceRequest.findOne({ orderId: req.params.id })
      .populate('customerId', 'username uid');
    return res.status(200).json({ request: request || null });
  } catch (error) {
    console.error('[Replace] getOrderReplaceRequest error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getAvailableItemsForOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Заказ не найден' });

    const items = await DigitalItem.find({
      productId: order.productId,
      productType: order.productType,
      status: 'available'
    }).select('uid originalName fileSize createdAt').sort({ createdAt: -1 });

    return res.status(200).json({ items });
  } catch (error) {
    console.error('[Replace] getAvailableItemsForOrder error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const processReplacement = async (req, res) => {
  try {
    const { newItemId } = req.body;
    const adminId = req.user._id;

    if (!newItemId) return res.status(400).json({ message: 'Укажите новый цифровой товар' });

    const order = await Order.findById(req.params.id)
      .populate('digitalItemIds', 'uid originalName');
    if (!order) return res.status(404).json({ message: 'Заказ не найден' });

    const newItem = await DigitalItem.findOne({ _id: newItemId, status: 'available' });
    if (!newItem) return res.status(404).json({ message: 'Выбранный товар недоступен' });

    if (String(newItem.productId) !== String(order.productId)) {
      return res.status(400).json({ message: 'Товар не принадлежит этому продукту' });
    }

    const lastItemId = order.digitalItemIds?.[order.digitalItemIds.length - 1]?._id || order.digitalItemId;

    if (lastItemId) {
      await DigitalItem.findByIdAndUpdate(lastItemId, { $set: { status: 'replaced' } });
    }

    await DigitalItem.findByIdAndUpdate(newItem._id, {
      $set: { status: 'replacement_issued', orderId: order._id }
    });

    const replaceReq = await ReplaceRequest.findOne({ orderId: order._id });
    const reason = replaceReq?.reason || '';

    order.digitalItemIds.push(newItem._id);
    order.status = 'replaced';
    order.replacements.push({
      oldItemId: lastItemId || null,
      newItemId: newItem._id,
      adminId,
      reason,
      createdAt: new Date()
    });
    await order.save();

    if (replaceReq) {
      replaceReq.status = 'resolved';
      await replaceReq.save();
    }

    const notif = await Notification.create({
      userId: order.customerId,
      type: 'order_replaced',
      title: { ru: 'Товар заменён', en: 'Product replaced' },
      message: {
        ru: `По заказу ${order.uid} выдана замена`,
        en: `Order ${order.uid} has been replaced`
      },
      link: `/profile/orders?search=${order.uid}`
    });

    io.of('/customer').to(`customer:${order.customerId}`).emit('notification', {
      id: notif._id, type: notif.type, title: notif.title,
      message: notif.message, link: notif.link, createdAt: notif.createdAt
    });

    return res.status(200).json({ message: 'Замена выдана', order });
  } catch (error) {
    console.error('[Replace] processReplacement error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const processRefund = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Заказ не найден' });

    if (order.status === 'cancelled') {
      return res.status(400).json({ message: 'Заказ уже отменён' });
    }

    const customer = await CustomerUser.findByIdAndUpdate(
      order.customerId,
      { $inc: { balance: order.amount } },
      { returnDocument: 'after' }
    );

    if (!customer) return res.status(404).json({ message: 'Покупатель не найден' });

    await Transaction.create({
      userId: order.customerId,
      type: 'deposit_admin',
      status: 'success',
      amount: order.amount,
      currency: order.currency || 'USD',
      note: `Возврат по заказу ${order.uid}`
    });

    order.status = 'cancelled';
    await order.save();

    clawbackReferralReward({ orderId: order._id, orderType: 'order' }).catch(() => {});

    const notif = await Notification.create({
      userId: order.customerId,
      type: 'order_refunded',
      title: { ru: 'Возврат средств', en: 'Refund issued' },
      message: {
        ru: `По заказу ${order.uid} возвращено $${order.amount.toFixed(2)}`,
        en: `Order ${order.uid} refunded $${order.amount.toFixed(2)}`
      },
      link: `/profile/orders?search=${order.uid}`
    });

    io.of('/customer').to(`customer:${order.customerId}`).emit('balance_updated', { balance: customer.balance });
    io.of('/customer').to(`customer:${order.customerId}`).emit('notification', {
      id: notif._id, type: notif.type, title: notif.title,
      message: notif.message, link: notif.link, createdAt: notif.createdAt
    });

    return res.status(200).json({ message: `Возврат $${order.amount.toFixed(2)} выполнен`, order });
  } catch (error) {
    console.error('[Replace] processRefund error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getReplacementsHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', startDate, endDate } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const matchStage = { 'replacements.0': { $exists: true } };

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = end;
      }
    }

    if (search) {
      const safe = String(search).slice(0, 100);
      const orConditions = [
        { uid: { $regex: safe, $options: 'i' } },
        { 'productSnapshot.title': { $regex: safe, $options: 'i' } }
      ];

      const matchingCustomers = await CustomerUser.find(
        { username: { $regex: safe, $options: 'i' } }
      ).select('_id').limit(50);
      if (matchingCustomers.length) {
        orConditions.push({ customerId: { $in: matchingCustomers.map(c => c._id) } });
      }

      matchStage.$or = orConditions;
    }

    const orders = await Order.find(matchStage)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('uid customerId productSnapshot productType quantity amount status replacements createdAt updatedAt')
      .populate('customerId', 'username uid')
      .populate('replacements.oldItemId', 'uid originalName')
      .populate('replacements.newItemId', 'uid originalName')
      .populate('replacements.adminId', 'login');

    const total = await Order.countDocuments(matchStage);

    return res.status(200).json({
      orders,
      total,
      pages: Math.ceil(total / Number(limit)),
      currentPage: Number(page)
    });
  } catch (error) {
    console.error('[Replace] getReplacementsHistory error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export { deleteReplacePhoto };
