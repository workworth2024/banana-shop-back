import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ServiceOrder from '../models/ServiceOrder.js';
import Service from '../models/Service.js';
import Notification from '../models/Notification.js';
import { io } from '../server.js';
import { createAdminNotif } from './adminNotifController.js';
import { deleteUploadFile } from '../utils/deleteFile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_ORDERS_DIR = path.join(__dirname, '..', 'uploads', 'service-orders');

const STATUS_TITLES = {
  in_progress: { ru: 'Услуга взята в работу', en: 'Service in progress' },
  completed:   { ru: 'Услуга выполнена',       en: 'Service completed'  },
  cancelled:   { ru: 'Услуга отменена',         en: 'Service cancelled'  }
};
const STATUS_MSGS = {
  in_progress: (uid) => `Ваша заявка на услугу ${uid} взята в работу`,
  completed:   (uid) => `Ваша заявка на услугу ${uid} выполнена`,
  cancelled:   (uid) => `Ваша заявка на услугу ${uid} была отменена`
};

async function sendStatusNotif(order) {
  if (!order.customerId) return;
  const titles = STATUS_TITLES[order.status];
  if (!titles) return;
  const notif = await Notification.create({
    userId: order.customerId,
    type: 'service_order_status',
    title: titles.ru,
    message: STATUS_MSGS[order.status](order.uid),
    link: `/profile/service-orders?search=${order.uid}`
  });
  io.of('/customer').to(`customer:${String(order.customerId)}`).emit('notification', {
    id: notif._id, type: notif.type, title: notif.title,
    message: notif.message, link: notif.link, createdAt: notif.createdAt
  });
}

export const createServiceOrder = async (req, res) => {
  try {
    const { serviceId, responses } = req.body;
    if (!serviceId) return res.status(400).json({ message: 'serviceId required' });

    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    const parsedResponses = typeof responses === 'string' ? JSON.parse(responses) : (responses || []);

    const customerFiles = (req.files || []).map(f => ({
      path: f.path,
      originalName: f.originalname,
      size: f.size,
      stepId: f.fieldname?.startsWith('step_') ? f.fieldname.replace('step_', '') : null
    }));

    const order = await ServiceOrder.create({
      customerId: req.customer._id,
      serviceId,
      scenarioId: service.scenarioId || null,
      serviceSnapshot: {
        title: service.title?.ru || service.title?.en || '',
        price: service.price || 0
      },
      responses: parsedResponses,
      customerFiles
    });

    const serviceTitle = service.title?.ru || service.title?.en || String(serviceId);
    createAdminNotif({
      category: 'order_service',
      type: 'order_service',
      title: 'Новая заявка на услугу',
      message: `Новая заявка на «${serviceTitle}» — ${order.uid}`,
      link: `/service-orders`,
      meta: { orderId: order._id, uid: order.uid }
    });

    return res.status(201).json(order);
  } catch (err) {
    console.error('[ServiceOrder] createServiceOrder error:', err);
    if (req.files) req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

export const getMyServiceOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', status = '', startDate, endDate } = req.query;
    const query = { customerId: req.customer._id };
    if (search) {
      const safe = String(search).slice(0, 100);
      query.$or = [
        { uid: { $regex: safe, $options: 'i' } },
        { 'serviceSnapshot.title': { $regex: safe, $options: 'i' } }
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
    const [orders, total] = await Promise.all([
      ServiceOrder.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select('-customerFiles.path -resultFiles.path'),
      ServiceOrder.countDocuments(query)
    ]);
    return res.json({ orders, total, pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const downloadResultFile = async (req, res) => {
  try {
    const order = await ServiceOrder.findOne({ uid: req.params.uid, customerId: req.customer._id });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'completed') return res.status(403).json({ message: 'Files available only for completed orders' });

    const file = order.resultFiles.id(req.params.fileId);
    if (!file) return res.status(404).json({ message: 'File not found' });

    if (!fs.existsSync(file.path)) return res.status(404).json({ message: 'File not found on disk' });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(file.path).pipe(res);
  } catch (err) {
    console.error('[ServiceOrder] downloadResultFile error:', err);
    if (!res.headersSent) return res.status(500).json({ message: 'Server error' });
  }
};

export const getAllServiceOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', status = '', startDate, endDate } = req.query;
    const query = {};
    if (search) {
      const safe = String(search).slice(0, 100);
      query.$or = [
        { uid: { $regex: safe, $options: 'i' } },
        { 'serviceSnapshot.title': { $regex: safe, $options: 'i' } }
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
    const [orders, total] = await Promise.all([
      ServiceOrder.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('customerId', 'username uid')
        .populate('serviceId', 'title'),
      ServiceOrder.countDocuments(query)
    ]);
    return res.json({ orders, total, pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateServiceOrderStatus = async (req, res) => {
  try {
    const { status, adminComment } = req.body;
    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ message: 'Invalid status' });

    const order = await ServiceOrder.findByIdAndUpdate(
      req.params.id,
      { status, ...(adminComment !== undefined && { adminComment }) },
      { new: true }
    );
    if (!order) return res.status(404).json({ message: 'Order not found' });

    await sendStatusNotif(order);
    return res.json(order);
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const uploadResultFiles = async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) {
      if (req.files) req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
      return res.status(404).json({ message: 'Order not found' });
    }
    const newFiles = (req.files || []).map(f => ({
      path: f.path,
      originalName: f.originalname,
      size: f.size
    }));
    order.resultFiles.push(...newFiles);
    await order.save();
    return res.json({ resultFiles: order.resultFiles.map(f => ({ _id: f._id, originalName: f.originalName, size: f.size })) });
  } catch (err) {
    console.error('[ServiceOrder] uploadResultFiles error:', err);
    if (req.files) req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
    return res.status(500).json({ message: 'Server error' });
  }
};

export const downloadCustomerFile = async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const file = order.customerFiles.id(req.params.fileId);
    if (!file) return res.status(404).json({ message: 'File not found' });
    if (!fs.existsSync(file.path)) return res.status(404).json({ message: 'File not found on disk' });
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(file.path).pipe(res);
  } catch (err) {
    console.error('[ServiceOrder] downloadCustomerFile error:', err);
    if (!res.headersSent) return res.status(500).json({ message: 'Server error' });
  }
};

export const deleteResultFile = async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const file = order.resultFiles.id(req.params.fileId);
    if (!file) return res.status(404).json({ message: 'File not found' });
    deleteUploadFile(file.path);
    order.resultFiles.pull(req.params.fileId);
    await order.save();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};
