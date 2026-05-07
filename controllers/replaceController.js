import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Order from '../models/Order.js';
import DigitalItem from '../models/DigitalItem.js';
import ReplaceRequest from '../models/ReplaceRequest.js';
import CustomerUser from '../models/CustomerUser.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';
import { io } from '../server.js';
import { createAdminNotif } from './adminNotifController.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');

const getImageUrl = (filePath) => {
  const rel = path.relative(UPLOADS_ROOT, filePath).replace(/\\/g, '/');
  return `/uploads/${rel}`;
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

    const photos = (req.files || []).map(f => getImageUrl(f.path));

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
      link: '/orders',
      meta: { orderId: order._id }
    });

    return res.status(201).json({ message: 'Заявка отправлена' });
  } catch (error) {
    console.error('[Replace] submitReplaceRequest error:', error);
    return res.status(500).json({ message: 'Server error' });
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

    const lastItemId = order.digitalItemIds?.[order.digitalItemIds.length - 1]?._id
      || order.digitalItemId;

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
      title: 'Товар заменён',
      message: `По заказу ${order.uid} выдана замена`,
      link: `/profile/orders`
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
    const adminId = req.user._id;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Заказ не найден' });

    if (order.status === 'cancelled') {
      return res.status(400).json({ message: 'Заказ уже отменён' });
    }

    const customer = await CustomerUser.findByIdAndUpdate(
      order.customerId,
      { $inc: { balance: order.amount } },
      { new: true }
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

    const notif = await Notification.create({
      userId: order.customerId,
      type: 'order_refunded',
      title: 'Возврат средств',
      message: `По заказу ${order.uid} возвращено $${order.amount.toFixed(2)}`,
      link: `/profile/orders`
    });

    io.of('/customer').to(`customer:${order.customerId}`).emit('balance_updated', {
      balance: customer.balance
    });

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
    const { page = 1, limit = 20, search = '' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const matchStage = { 'replacements.0': { $exists: true } };

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
