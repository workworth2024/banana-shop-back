import Preorder from '../models/Preorder.js';
import GoogleAdsProduct from '../models/GoogleAdsProduct.js';
import YoutubeProduct from '../models/YoutubeProduct.js';
import CustomerUser from '../models/CustomerUser.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';
import { io } from '../server.js';
import { createAdminNotif } from './adminNotifController.js';
import { bunnyUpload, bunnyDownload, generateFilename, isBunnyPath } from '../utils/bunnyStorage.js';
import { deleteAnyFile } from '../utils/deleteFile.js';
import { escapeRegex } from '../utils/safeQuery.js';
import { creditReferralReward } from '../utils/referral.js';
import { isValidGeo } from '../utils/geos.js';

const NOTIF_TITLES = {
  in_progress: { ru: 'Предзаказ взят в работу', en: 'Preorder in progress' },
  completed:   { ru: 'Предзаказ выполнен',       en: 'Preorder completed'   },
  cancelled:   { ru: 'Предзаказ отменён',         en: 'Preorder cancelled'   },
};

const NOTIF_MSGS = {
  in_progress: (uid) => ({ ru: `Ваш предзаказ ${uid} взят в работу`, en: `Your preorder ${uid} is in progress` }),
  completed:   (uid) => ({ ru: `Ваш предзаказ ${uid} выполнен — файлы доступны для скачивания`, en: `Your preorder ${uid} is completed — files are ready to download` }),
  cancelled:   (uid) => ({ ru: `Ваш предзаказ ${uid} был отменён`, en: `Your preorder ${uid} has been cancelled` }),
};

async function sendPreorderNotif(preorder) {
  if (!preorder.customerId) return;
  const { status, uid, customerId } = preorder;
  const titles = NOTIF_TITLES[status];
  if (!titles) return;

  const notif = await Notification.create({
    userId: customerId,
    type: 'preorder_status',
    title: titles,
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
    if (!req.customer?._id) {
      return res.status(401).json({ message: 'Войдите в аккаунт для оформления предзаказа' });
    }

    const customerId = req.customer._id;
    const { google_item_id, youtube_item_id, name, telegram, desired_quantity, comment, geo, useBonusBalance = false } = req.body;

    let product = null;
    let productType = 'google';

    if (youtube_item_id) {
      product = await YoutubeProduct.findById(youtube_item_id);
      productType = 'youtube';
    } else if (google_item_id) {
      product = await GoogleAdsProduct.findById(google_item_id);
      productType = 'google';
    } else {
      return res.status(400).json({ message: 'Укажите товар предзаказа (google_item_id или youtube_item_id)' });
    }

    if (!product) return res.status(404).json({ message: 'Товар не найден' });
    if (!name || !telegram || desired_quantity === undefined || desired_quantity === null) {
      return res.status(400).json({ message: 'Обязательные поля: name, telegram, desired_quantity' });
    }

    const geoCode = String(geo || '').trim().toUpperCase();
    if (!geoCode || !isValidGeo(geoCode)) {
      return res.status(400).json({ message: 'Выберите гео для предзаказа' });
    }
    const productGeoCodes = (product.geos || []).map(g => g.code);
    if (productGeoCodes.length && !productGeoCodes.includes(geoCode)) {
      return res.status(400).json({ message: `Гео ${geoCode} недоступно для этого товара` });
    }

    const qty = Math.max(1, Math.min(500, parseInt(desired_quantity, 10)));
    if (Number.isNaN(qty)) {
      return res.status(400).json({ message: 'Некорректное количество' });
    }

    const unitPrice = parseFloat(Number(product.price) || 0);
    if (unitPrice <= 0) {
      return res.status(400).json({ message: 'Предзаказ этого товара временно недоступен' });
    }

    const totalAmount = parseFloat((unitPrice * qty).toFixed(2));

    const preCustomer = await CustomerUser.findById(customerId).select('balance bonusBalance');
    if (!preCustomer) return res.status(404).json({ message: 'Пользователь не найден' });

    const availBonus = useBonusBalance ? (preCustomer.bonusBalance || 0) : 0;
    const fromBonus = Math.min(availBonus, totalAmount);
    const fromMain = parseFloat((totalAmount - fromBonus).toFixed(4));

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

    try {
      const preorder = await Preorder.create({
        google_item_id: productType === 'google' ? product._id : null,
        youtube_item_id: productType === 'youtube' ? product._id : null,
        productType,
        customerId,
        geo: geoCode,
        name: String(name).trim().slice(0, 200),
        telegram: String(telegram).trim().slice(0, 100),
        desired_quantity: qty,
        comment: comment ? String(comment).trim().slice(0, 1000) : '',
        unitPriceSnapshot: unitPrice,
        amountPaid: totalAmount,
        currency: 'USD',
        paymentMethod: 'balance',
        paymentStatus: 'paid'
      });

      const txDoc = await Transaction.create({
        userId: customerId,
        type: 'preorder',
        status: 'success',
        amount: -totalAmount,
        currency: 'USD',
        note: `Preorder ${preorder.uid} x${qty}${fromBonus > 0 ? ` (bonus $${fromBonus.toFixed(2)} + balance $${fromMain.toFixed(2)})` : ''}`
      });
      await Preorder.updateOne({ _id: preorder._id }, { paymentTransactionUid: txDoc.uid });

      creditReferralReward({
        customerId,
        orderAmount: totalAmount,
        orderType: 'preorder',
        orderId: preorder._id,
        orderUid: preorder.uid,
        productType: productType === 'youtube' ? 'YoutubeProduct' : 'GoogleAdsProduct'
      }).catch(() => {});

      io.of('/customer').to(`customer:${customerId}`).emit('balance_updated', {
        balance: customer.balance,
        bonusBalance: customer.bonusBalance
      });

      const productTitle = product.title?.ru || product.title?.en || String(product._id);
      createAdminNotif({
        category: 'order_preorder',
        type: 'order_preorder',
        title: 'Новый предзаказ',
        message: `${preorder.name} оплатил предзаказ «${productTitle}» (${qty} шт.) — ${preorder.uid} — $${totalAmount.toFixed(2)}`,
        link: `/preorders?search=${encodeURIComponent(preorder.uid)}`,
        meta: { preorderId: preorder._id, uid: preorder.uid, amount: totalAmount }
      });

      return res.status(201).json({
        ...preorder.toObject(),
        paymentTransactionUid: txDoc.uid,
        paymentStatus: 'paid'
      });
    } catch (inner) {
      const refund = {};
      if (fromMain > 0) refund.balance = fromMain;
      if (fromBonus > 0) refund.bonusBalance = fromBonus;
      if (Object.keys(refund).length) await CustomerUser.findByIdAndUpdate(customerId, { $inc: refund }).catch(() => {});
      console.error('[Preorder] createPreorder rollback:', inner);
      return res.status(500).json({ message: inner.message || 'Ошибка оформления предзаказа' });
    }
  } catch (error) {
    console.error('[Preorder] createPreorder error:', error);
    return res.status(500).json({ message: error.message || 'Error creating preorder' });
  }
};

export const getPreorders = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', status = '', startDate, endDate } = req.query;
    const query = {};

    if (search) {
      const safe = escapeRegex(String(search).slice(0, 100));
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

    const preorder = await Preorder.findByIdAndUpdate(id, { status }, { returnDocument: 'after' })
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
    if (!preorder) return res.status(404).json({ message: 'Preorder not found' });

    const newFiles = [];
    for (const f of (req.files || [])) {
      const filename = generateFilename(f.originalname);
      const remotePath = `/preorders/${filename}`;
      await bunnyUpload(remotePath, f.buffer, f.mimetype);
      newFiles.push({ path: remotePath, originalName: f.originalname, size: f.size });
    }

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

    deleteAnyFile(fileEntry.path);
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
      .populate('youtube_item_id', 'title path_image')
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

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileEntry.originalName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    if (fileEntry.size) res.setHeader('Content-Length', fileEntry.size);

    if (isBunnyPath(fileEntry.path)) {
      const { stream } = await bunnyDownload(fileEntry.path);
      return stream.pipe(res);
    }

    const fs = await import('fs');
    if (!fs.existsSync(fileEntry.path)) {
      return res.status(404).json({ message: 'Файл не найден на сервере' });
    }
    return fs.createReadStream(fileEntry.path).pipe(res);
  } catch (error) {
    console.error('[Preorder] downloadMyPreorderFile error:', error);
    if (!res.headersSent) res.status(500).json({ message: 'Server error' });
  }
};

export const deletePreorder = async (req, res) => {
  try {
    const preorder = await Preorder.findByIdAndDelete(req.params.id);
    if (preorder?.files?.length) {
      for (const f of preorder.files) {
        deleteAnyFile(f.path);
      }
    }
    res.json({ message: 'Preorder deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting preorder' });
  }
};
