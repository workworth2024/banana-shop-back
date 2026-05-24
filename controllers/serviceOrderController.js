import ServiceOrder from '../models/ServiceOrder.js';
import Service from '../models/Service.js';
import CustomerUser from '../models/CustomerUser.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';
import { io } from '../server.js';
import { createAdminNotif } from './adminNotifController.js';
import { bunnyUpload, bunnyDownload, generateFilename, isBunnyPath } from '../utils/bunnyStorage.js';
import { deleteAnyFile } from '../utils/deleteFile.js';
import { creditReferralReward } from '../utils/referral.js';

const STATUS_TITLES = {
  in_progress: { ru: 'Услуга взята в работу', en: 'Service in progress' },
  completed:   { ru: 'Услуга выполнена',       en: 'Service completed'  },
  cancelled:   { ru: 'Услуга отменена',         en: 'Service cancelled'  }
};
const STATUS_MSGS = {
  in_progress: (uid) => ({ ru: `Ваша заявка на услугу ${uid} взята в работу`, en: `Your service order ${uid} is in progress` }),
  completed:   (uid) => ({ ru: `Ваша заявка на услугу ${uid} выполнена`, en: `Your service order ${uid} is completed` }),
  cancelled:   (uid) => ({ ru: `Ваша заявка на услугу ${uid} была отменена`, en: `Your service order ${uid} has been cancelled` })
};

async function sendStatusNotif(order) {
  if (!order.customerId) return;
  const titles = STATUS_TITLES[order.status];
  if (!titles) return;
  const notif = await Notification.create({
    userId: order.customerId,
    type: 'service_order_status',
    title: titles,
    message: STATUS_MSGS[order.status](order.uid),
    link: `/profile/service-orders?search=${order.uid}`
  });
  io.of('/customer').to(`customer:${String(order.customerId)}`).emit('notification', {
    id: notif._id, type: notif.type, title: notif.title,
    message: notif.message, link: notif.link, createdAt: notif.createdAt
  });
}

export const createServiceOrder = async (req, res) => {
  const customerId = req.customer._id;

  try {
    const { serviceId, responses, useBonusBalance = false } = req.body;
    if (!serviceId) return res.status(400).json({ message: 'serviceId required' });

    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    const chargeAmount = parseFloat(Number(service.price) || 0);
    if (chargeAmount <= 0) {
      return res.status(400).json({ message: 'Стоимость услуги не задана' });
    }

    let parsedResponses;
    try {
      parsedResponses = typeof responses === 'string' ? JSON.parse(responses || '[]') : (responses || []);
      if (!Array.isArray(parsedResponses)) parsedResponses = [];
    } catch {
      return res.status(400).json({ message: 'Некорректный формат ответов' });
    }

    const useBonusBool = useBonusBalance === true || useBonusBalance === 'true';
    const preCustomer = await CustomerUser.findById(customerId).select('balance bonusBalance');
    if (!preCustomer) return res.status(404).json({ message: 'Пользователь не найден' });

    const availBonus = useBonusBool ? (preCustomer.bonusBalance || 0) : 0;
    const fromBonus = Math.min(availBonus, chargeAmount);
    const fromMain = parseFloat((chargeAmount - fromBonus).toFixed(4));

    if ((preCustomer.balance || 0) < fromMain) {
      return res.status(400).json({ message: 'Недостаточно средств на балансе' });
    }

    const inc = {};
    if (fromMain > 0) inc.balance = -fromMain;
    if (fromBonus > 0) inc.bonusBalance = -fromBonus;

    const customer = await CustomerUser.findOneAndUpdate(
      {
        _id: customerId,
        balance: { $gte: fromMain },
        ...(fromBonus > 0 ? { bonusBalance: { $gte: fromBonus } } : {})
      },
      { $inc: inc },
      { returnDocument: 'after' }
    );

    if (!customer) {
      return res.status(400).json({ message: 'Недостаточно средств на балансе' });
    }

    const customerFiles = [];
    let persistedOrderId = null;
    try {
      for (const f of (req.files || [])) {
        const filename = generateFilename(f.originalname);
        const remotePath = `/service-orders/${filename}`;
        await bunnyUpload(remotePath, f.buffer, f.mimetype);
        customerFiles.push({
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
        serviceSnapshot: {
          title: serviceTitle,
          price: chargeAmount
        },
        amountPaid: chargeAmount,
        currency: 'USD',
        paymentMethod: 'balance',
        paymentStatus: 'paid',
        responses: parsedResponses,
        customerFiles
      });
      persistedOrderId = order._id;

      let paymentTransactionUid = '';
      try {
        const txDoc = await Transaction.create({
          userId: customerId,
          type: 'service_order',
          status: 'success',
          amount: -chargeAmount,
          currency: 'USD',
          note: `Service ${order.uid}${fromBonus > 0 ? ` (bonus $${fromBonus.toFixed(2)} + balance $${fromMain.toFixed(2)})` : ''}`
        });
        paymentTransactionUid = txDoc.uid;
        await ServiceOrder.updateOne({ _id: order._id }, { paymentTransactionUid: txDoc.uid });
      } catch (txErr) {
        await ServiceOrder.findByIdAndDelete(order._id).catch(() => {});
        persistedOrderId = null;
        throw txErr;
      }

      creditReferralReward({
        customerId,
        orderAmount: chargeAmount,
        orderType: 'service_order',
        orderId: order._id,
        orderUid: order.uid
      }).catch(() => {});

      io.of('/customer').to(`customer:${String(customerId)}`).emit('balance_updated', {
        balance: customer.balance,
        bonusBalance: customer.bonusBalance
      });

      createAdminNotif({
        category: 'order_service',
        type: 'order_service',
        title: 'Новая заявка на услугу',
        message: `Оплачена заявка «${serviceTitle}» — ${order.uid} — $${chargeAmount.toFixed(2)}`,
        link: `/service-orders?search=${encodeURIComponent(order.uid)}`,
        meta: { orderId: order._id, uid: order.uid, amount: chargeAmount }
      });

      return res.status(201).json({
        ...order.toObject(),
        paymentTransactionUid
      });
    } catch (err) {
      for (const cf of customerFiles) {
        if (cf.path) deleteAnyFile(cf.path);
      }
      if (persistedOrderId) await ServiceOrder.findByIdAndDelete(persistedOrderId).catch(() => {});
      const refund = {};
      if (fromMain > 0) refund.balance = fromMain;
      if (fromBonus > 0) refund.bonusBalance = fromBonus;
      if (Object.keys(refund).length) await CustomerUser.findByIdAndUpdate(customerId, { $inc: refund }).catch(() => {});
      console.error('[ServiceOrder] createServiceOrder error:', err);
      return res.status(500).json({ message: err.message || 'Server error' });
    }
  } catch (err) {
    console.error('[ServiceOrder] createServiceOrder outer error:', err);
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

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    if (file.size) res.setHeader('Content-Length', file.size);

    if (isBunnyPath(file.path)) {
      const { stream } = await bunnyDownload(file.path);
      return stream.pipe(res);
    }

    const fs = await import('fs');
    if (!fs.existsSync(file.path)) return res.status(404).json({ message: 'File not found on disk' });
    return fs.createReadStream(file.path).pipe(res);
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
      { returnDocument: 'after' }
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
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const newFiles = [];
    for (const f of (req.files || [])) {
      const filename = generateFilename(f.originalname);
      const remotePath = `/service-orders/${filename}`;
      await bunnyUpload(remotePath, f.buffer, f.mimetype);
      newFiles.push({ path: remotePath, originalName: f.originalname, size: f.size });
    }

    order.resultFiles.push(...newFiles);
    await order.save();
    return res.json({ resultFiles: order.resultFiles.map(f => ({ _id: f._id, originalName: f.originalName, size: f.size })) });
  } catch (err) {
    console.error('[ServiceOrder] uploadResultFiles error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const downloadCustomerFile = async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const file = order.customerFiles.id(req.params.fileId);
    if (!file) return res.status(404).json({ message: 'File not found' });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    if (file.size) res.setHeader('Content-Length', file.size);

    if (isBunnyPath(file.path)) {
      const { stream } = await bunnyDownload(file.path);
      return stream.pipe(res);
    }

    const fs = await import('fs');
    if (!fs.existsSync(file.path)) return res.status(404).json({ message: 'File not found on disk' });
    return fs.createReadStream(file.path).pipe(res);
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
    deleteAnyFile(file.path);
    order.resultFiles.pull(req.params.fileId);
    await order.save();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};
