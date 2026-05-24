import fs from 'fs';
import Order from '../models/Order.js';
import DigitalItem from '../models/DigitalItem.js';
import CustomerUser from '../models/CustomerUser.js';
import Notification from '../models/Notification.js';
import { io } from '../server.js';
import { bunnyDownload, isBunnyPath } from '../utils/bunnyStorage.js';
import { escapeRegex } from '../utils/safeQuery.js';
import { creditReferralReward } from '../utils/referral.js';

export const getMyOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', startDate, endDate, status } = req.query;
    const customerId = req.customer._id;

    const query = { customerId };

    if (search) {
      const safe = escapeRegex(String(search).slice(0, 100));
      query.$or = [
        { uid: { $regex: safe, $options: 'i' } },
        { 'productSnapshot.title': { $regex: safe, $options: 'i' } }
      ];
    }

    if (status) query.status = status;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const pg = Math.min(10000, Math.max(1, parseInt(page) || 1));
    const lim = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pg - 1) * lim;

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .select('-digitalItemId -accessKey')
      .populate('digitalItemIds', 'uid originalName fileSize');

    const total = await Order.countDocuments(query);

    return res.status(200).json({
      orders,
      total,
      pages: Math.ceil(total / lim),
      currentPage: pg
    });
  } catch (error) {
    console.error('[Orders] getMyOrders error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getMyOrder = async (req, res) => {
  try {
    const order = await Order.findOne({
      uid: req.params.uid,
      customerId: req.customer._id
    })
      .select('-digitalItemId -accessKey')
      .populate('digitalItemIds', 'uid originalName fileSize');

    if (!order) return res.status(404).json({ message: 'Order not found' });

    return res.status(200).json({ order });
  } catch (error) {
    console.error('[Orders] getMyOrder error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const downloadMyItemFile = async (req, res) => {
  try {
    const order = await Order.findOne({
      uid: req.params.uid,
      customerId: req.customer._id,
      status: { $in: ['delivered', 'replaced'] }
    }).populate('digitalItemIds', 'uid originalName fileSize filePath');

    if (!order) return res.status(404).json({ message: 'Order not found or not delivered' });

    const replacedItemIds = new Set(
      (order.replacements || []).map(r => String(r.oldItemId))
    );
    const item = order.digitalItemIds?.find(
      i => i.uid === req.params.itemUid && !replacedItemIds.has(String(i._id))
    );
    if (!item) return res.status(404).json({ message: 'Item not found in this order' });

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(item.originalName)}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    if (item.fileSize) res.setHeader('Content-Length', item.fileSize);

    if (isBunnyPath(item.filePath)) {
      const { stream } = await bunnyDownload(item.filePath);
      return stream.pipe(res);
    }

    if (!fs.existsSync(item.filePath)) {
      return res.status(404).json({ message: 'File not found on disk' });
    }
    return fs.createReadStream(item.filePath).pipe(res);
  } catch (error) {
    console.error('[Orders] downloadMyItemFile error:', error);
    if (!res.headersSent) return res.status(500).json({ message: 'Server error' });
  }
};

export const getAllOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', status, startDate, endDate } = req.query;
    const query = {};

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (search) {
      const safe = escapeRegex(String(search).slice(0, 100));
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

      const matchingItems = await DigitalItem.find(
        { uid: { $regex: safe, $options: 'i' } }
      ).select('_id').limit(50);
      if (matchingItems.length) {
        orConditions.push({ digitalItemIds: { $in: matchingItems.map(i => i._id) } });
      }

      query.$or = orConditions;
    }

    if (status) query.status = status;

    const pg = Math.min(10000, Math.max(1, parseInt(page) || 1));
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 20));
    const skip = (pg - 1) * lim;

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .select('-accessKey')
      .populate('customerId', 'username uid')
      .populate('digitalItemIds', 'uid originalName')
      .populate('productId', 'uid');

    const total = await Order.countDocuments(query);

    return res.status(200).json({
      orders,
      total,
      pages: Math.ceil(total / lim),
      currentPage: pg
    });
  } catch (error) {
    console.error('[Orders] getAllOrders error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

const ORDER_STATUS_LABELS = {
  unpaid:              { ru: 'Не оплачен',    en: 'Unpaid' },
  pending:             { ru: 'Ожидает',        en: 'Pending' },
  paid:                { ru: 'Оплачен',         en: 'Paid' },
  delivered:           { ru: 'Доставлен',       en: 'Delivered' },
  cancelled:           { ru: 'Отменён',          en: 'Cancelled' },
  replaced:            { ru: 'Заменён',           en: 'Replaced' },
  waiting_replacement: { ru: 'Ждёт замены',      en: 'Awaiting replacement' }
};

export const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['unpaid', 'pending', 'paid', 'delivered', 'cancelled', 'replaced', 'waiting_replacement'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { returnDocument: 'after' }
    );

    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (status === 'delivered') {
      creditReferralReward({
        customerId: order.customerId,
        orderAmount: order.amount,
        orderType: 'order',
        orderId: order._id,
        orderUid: order.uid,
        productType: order.productType || order.productSnapshot?.productType
      }).catch(() => {});
    }

    try {
      const statusLabels = ORDER_STATUS_LABELS[status] || { ru: status, en: status };
      const notif = await Notification.create({
        userId: order.customerId,
        type: 'order_status',
        title: { ru: 'Статус заказа изменён', en: 'Order status updated' },
        message: {
          ru: `Заказ ${order.uid}: статус → ${statusLabels.ru}`,
          en: `Order ${order.uid}: status → ${statusLabels.en}`
        },
        link: '/profile/orders'
      });
      io.of('/customer').to(`customer:${order.customerId}`).emit('notification', {
        id: notif._id, type: notif.type, title: notif.title,
        message: notif.message, link: notif.link, createdAt: notif.createdAt
      });
    } catch {}

    return res.status(200).json({ order });
  } catch (error) {
    console.error('[Orders] updateOrderStatus error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const deleteOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    return res.status(200).json({ message: 'Order deleted' });
  } catch (error) {
    console.error('[Orders] deleteOrder error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
