import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Preorder from '../models/Preorder.js';
import GoogleAdsProduct from '../models/GoogleAdsProduct.js';
import Notification from '../models/Notification.js';
import { io } from '../server.js';
import { deleteUploadFile } from '../utils/deleteFile.js';
import { createAdminNotif } from './adminNotifController.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREORDERS_DIR = path.join(__dirname, '..', 'uploads', 'preorders');

const NOTIF_TITLES = {
  in_progress: { ru: 'Предзаказ взят в работу', en: 'Preorder in progress' },
  completed:   { ru: 'Предзаказ выполнен',       en: 'Preorder completed'   },
  cancelled:   { ru: 'Предзаказ отменён',         en: 'Preorder cancelled'   },
};

const NOTIF_MSGS = {
  in_progress: (uid) => `Ваш предзаказ ${uid} взят в работу`,
  completed:   (uid) => `Ваш предзаказ ${uid} выполнен — файлы доступны для скачивания`,
  cancelled:   (uid) => `Ваш предзаказ ${uid} был отменён`,
};

async function sendPreorderNotif(preorder) {
  if (!preorder.customerId) return;
  const { status, uid, customerId } = preorder;
  const titles = NOTIF_TITLES[status];
  if (!titles) return;

  const notif = await Notification.create({
    userId: customerId,
    type: 'preorder_status',
    title: titles.ru,
    message: NOTIF_MSGS[status](uid),
    link: `/profile/preorders?search=${uid}`
  });

  io.of('/customer').to(`customer:${customerId}`).emit('notification', {
    id: notif._id, type: notif.type, title: notif.title,
    message: notif.message, link: notif.link, createdAt: notif.createdAt
  });
}

export const createPreorder = async (req, res) => {
  try {
    const { google_item_id, name, telegram, desired_quantity, comment } = req.body;
    if (!google_item_id || !name || !telegram || !desired_quantity) {
      return res.status(400).json({ message: 'Обязательные поля: google_item_id, name, telegram, desired_quantity' });
    }
    const product = await GoogleAdsProduct.findById(google_item_id);
    if (!product) return res.status(404).json({ message: 'Товар не найден' });

    const preorderData = {
      google_item_id,
      name: String(name).trim().slice(0, 200),
      telegram: String(telegram).trim().slice(0, 100),
      desired_quantity: parseInt(desired_quantity),
      comment: comment ? String(comment).trim().slice(0, 1000) : ''
    };

    if (req.customer?._id) preorderData.customerId = req.customer._id;

    const preorder = await Preorder.create(preorderData);

    const productTitle = product.title?.ru || product.title?.en || String(google_item_id);
    createAdminNotif({
      category: 'order_preorder',
      type: 'order_preorder',
      title: 'Новый предзаказ',
      message: `${preorder.name} оформил предзаказ на «${productTitle}» (${preorder.desired_quantity} шт.) — ${preorder.uid}`,
      link: `/preorders`,
      meta: { preorderId: preorder._id, uid: preorder.uid }
    });

    res.status(201).json(preorder);
  } catch (error) {
    console.error('[Preorder] createPreorder error:', error);
    res.status(500).json({ message: error.message || 'Error creating preorder' });
  }
};

export const getPreorders = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', status = '', startDate, endDate } = req.query;
    const query = {};

    if (search) {
      const safe = String(search).slice(0, 200);
      query.$or = [
        { name: { $regex: safe, $options: 'i' } },
        { telegram: { $regex: safe, $options: 'i' } },
        { uid: { $regex: safe, $options: 'i' } }
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
    const preorders = await Preorder.find(query)
      .populate('google_item_id', 'title _id uid')
      .populate('customerId', 'username uid')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Preorder.countDocuments(query);
    res.json({ preorders, total, pages: Math.ceil(total / Number(limit)) });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching preorders' });
  }
};

export const updatePreorderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const preorder = await Preorder.findByIdAndUpdate(id, { status }, { new: true })
      .populate('google_item_id', 'title');
    if (!preorder) return res.status(404).json({ message: 'Preorder not found' });

    await sendPreorderNotif(preorder);

    res.json(preorder);
  } catch (error) {
    res.status(500).json({ message: 'Error updating preorder' });
  }
};

export const uploadPreorderFiles = async (req, res) => {
  try {
    const preorder = await Preorder.findById(req.params.id);
    if (!preorder) {
      if (req.files) req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
      return res.status(404).json({ message: 'Preorder not found' });
    }

    const newFiles = (req.files || []).map(f => ({
      path: f.path,
      originalName: f.originalname,
      size: f.size
    }));

    preorder.files.push(...newFiles);
    await preorder.save();

    res.json({ message: `${newFiles.length} file(s) uploaded`, files: preorder.files });
  } catch (error) {
    console.error('[Preorder] uploadPreorderFiles error:', error);
    res.status(500).json({ message: 'Error uploading files' });
  }
};

export const deletePreorderFile = async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const preorder = await Preorder.findById(id);
    if (!preorder) return res.status(404).json({ message: 'Preorder not found' });

    const fileEntry = preorder.files.id(fileId);
    if (!fileEntry) return res.status(404).json({ message: 'File not found' });

    if (fs.existsSync(fileEntry.path)) fs.unlinkSync(fileEntry.path);
    preorder.files.pull(fileId);
    await preorder.save();

    res.json({ message: 'File deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting file' });
  }
};

export const getMyPreorders = async (req, res) => {
  try {
    const customerId = req.customer._id;
    const { page = 1, limit = 10, search = '', status = '', startDate, endDate } = req.query;
    const query = { customerId };

    if (search) {
      const safe = String(search).slice(0, 200);
      query.$or = [{ uid: { $regex: safe, $options: 'i' } }];
    }

    if (status && ['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      query.status = status;
    }

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
    const preorders = await Preorder.find(query)
      .populate('google_item_id', 'title path_image')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-files.path');

    const total = await Preorder.countDocuments(query);
    res.json({ preorders, total, pages: Math.ceil(total / Number(limit)) });
  } catch (error) {
    console.error('[Preorder] getMyPreorders error:', error);
    res.status(500).json({ message: 'Error fetching preorders' });
  }
};

export const downloadMyPreorderFile = async (req, res) => {
  try {
    const { uid, fileId } = req.params;
    const customerId = req.customer._id;

    const preorder = await Preorder.findOne({ uid, customerId });
    if (!preorder) return res.status(404).json({ message: 'Предзаказ не найден' });

    if (preorder.status !== 'completed') {
      return res.status(403).json({ message: 'Файлы доступны только для выполненных предзаказов' });
    }

    const fileEntry = preorder.files.id(fileId);
    if (!fileEntry) return res.status(404).json({ message: 'Файл не найден' });

    if (!fs.existsSync(fileEntry.path)) {
      return res.status(404).json({ message: 'Файл не найден на сервере' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileEntry.originalName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(fileEntry.path).pipe(res);
  } catch (error) {
    console.error('[Preorder] downloadMyPreorderFile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const deletePreorder = async (req, res) => {
  try {
    const preorder = await Preorder.findByIdAndDelete(req.params.id);
    if (preorder?.files?.length) {
      for (const f of preorder.files) {
        if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
      }
    }
    res.json({ message: 'Preorder deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting preorder' });
  }
};
