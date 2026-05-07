import fs from 'fs';
import Order from '../models/Order.js';
import DigitalItem from '../models/DigitalItem.js';
import CustomerUser from '../models/CustomerUser.js';
import Notification from '../models/Notification.js';
import { io } from '../server.js';

export const getMyOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', startDate, endDate, status } = req.query;
    const customerId = req.customer._id;

    const query = { customerId };

    if (search) {
      const safe = String(search).slice(0, 100);
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

    const skip = (Number(page) - 1) * Number(limit);

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('-digitalItemId -accessKey')
      .populate('digitalItemIds', 'uid originalName fileSize');

    const total = await Order.countDocuments(query);

    return res.status(200).json({
      orders,
      total,
      pages: Math.ceil(total / Number(limit)),
      currentPage: Number(page)
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

    if (!fs.existsSync(item.filePath)) {
      return res.status(404).json({ message: 'File not found on disk' });
    }

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(item.originalName)}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', item.fileSize);
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

      const matchingItems = await DigitalItem.find(
        { uid: { $regex: safe, $options: 'i' } }
      ).select('_id').limit(50);
      if (matchingItems.length) {
        orConditions.push({ digitalItemIds: { $in: matchingItems.map(i => i._id) } });
      }

      query.$or = orConditions;
    }

    if (status) query.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('-accessKey')
      .populate('customerId', 'username uid')
      .populate('digitalItemIds', 'uid originalName');

    const total = await Order.countDocuments(query);

    return res.status(200).json({
      orders,
      total,
      pages: Math.ceil(total / Number(limit)),
      currentPage: Number(page)
    });
  } catch (error) {
    console.error('[Orders] getAllOrders error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

const ORDER_STATUS_LABELS = {
  unpaid: 'Не оплачен', pending: 'Ожидает', paid: 'Оплачен',
  delivered: 'Доставлен', cancelled: 'Отменён', replaced: 'Заменён',
  waiting_replacement: 'Ждёт замены'
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
      { new: true }
    );

    if (!order) return res.status(404).json({ message: 'Order not found' });

    try {
      const notif = await Notification.create({
        userId: order.customerId,
        type: 'order_status',
        title: 'Статус заказа изменён',
        message: `Заказ ${order.uid}: статус → ${ORDER_STATUS_LABELS[status] || status}`,
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
