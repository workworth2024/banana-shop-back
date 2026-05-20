import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import DigitalItem from '../models/DigitalItem.js';
import GoogleAdsProduct from '../models/GoogleAdsProduct.js';
import YoutubeProduct from '../models/YoutubeProduct.js';
import Order from '../models/Order.js';
import Notification from '../models/Notification.js';
import Transaction from '../models/Transaction.js';
import CustomerUser from '../models/CustomerUser.js';
import { io } from '../server.js';
import { createAdminNotif } from './adminNotifController.js';
import { bunnyUpload, bunnyDelete, bunnyDownload, isBunnyPath } from '../utils/bunnyStorage.js';
import { escapeRegex } from '../utils/safeQuery.js';
import { isValidGeo } from '../utils/geos.js';
import { syncProductCounts } from '../utils/syncProductCounts.js';

const getProductModel = (productType) => {
  if (productType === 'GoogleAdsProduct') return GoogleAdsProduct;
  if (productType === 'YoutubeProduct') return YoutubeProduct;
  return null;
};

export const uploadDigitalItems = async (req, res) => {
  try {
    const { productId, productType } = req.params;

    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }

    const ProductModel = getProductModel(productType);
    if (!ProductModel) return res.status(400).json({ message: 'Invalid product type' });

    const product = await ProductModel.findById(productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const geo = String(req.body.geo || req.query.geo || '').trim().toUpperCase();
    if (!geo || !isValidGeo(geo)) {
      return res.status(400).json({ message: 'Invalid or missing geo code' });
    }
    const productGeoCodes = (product.geos || []).map(g => g.code);
    if (!productGeoCodes.includes(geo)) {
      return res.status(400).json({ message: `Geo ${geo} is not configured for this product` });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const total = req.files.length;
    const items = [];

    for (let i = 0; i < total; i++) {
      const file = req.files[i];
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext)
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 80);
      const remoteName = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${base}${ext}`;
      const remotePath = `/digital-items/${remoteName}`;

      io.of('/admin').to('admins').emit('digital_upload_progress', {
        index: i,
        total,
        fileName: file.originalname,
        fileSize: file.size,
        status: 'uploading'
      });

      await bunnyUpload(remotePath, file.buffer, file.mimetype);

      items.push({
        productId,
        productType,
        geo,
        filePath: remotePath,
        originalName: file.originalname,
        fileSize: file.size
      });

      io.of('/admin').to('admins').emit('digital_upload_progress', {
        index: i + 1,
        total,
        fileName: file.originalname,
        fileSize: file.size,
        status: 'done'
      });
    }

    await DigitalItem.insertMany(items);

    const syncResult = await syncProductCounts(productId, productType);
    const newCount = syncResult.total;

    io.of('/admin').to('admins').emit('digital_upload_progress', {
      index: total,
      total,
      status: 'complete',
      newCount,
      geos: syncResult.geos
    });

    return res.status(201).json({
      message: `${items.length} file(s) uploaded`,
      uploaded: items.length,
      newCount,
      geo,
      geos: syncResult.geos,
      files: items.map(f => ({ originalName: f.originalName, fileSize: f.fileSize }))
    });
  } catch (error) {
    console.error('[DigitalItem] upload error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getDigitalItems = async (req, res) => {
  try {
    const { productId, productType } = req.params;
    const { page = 1, limit = 20, status, search, startDate, endDate, geo } = req.query;

    const query = { productId, productType };
    if (status) query.status = status;
    if (geo) query.geo = String(geo).toUpperCase();
    if (search) {
      const safe = escapeRegex(String(search).slice(0, 100));
      query.$or = [
        { originalName: { $regex: safe, $options: 'i' } },
        { uid: { $regex: safe, $options: 'i' } }
      ];
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        query.createdAt.$gte = s;
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        query.createdAt.$lte = e;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);

    const items = await DigitalItem.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('-filePath');

    const total = await DigitalItem.countDocuments(query);
    const baseStatsQuery = { productId, productType };
    if (geo) baseStatsQuery.geo = String(geo).toUpperCase();
    const available = await DigitalItem.countDocuments({ ...baseStatsQuery, status: 'available' });
    const sold = await DigitalItem.countDocuments({ ...baseStatsQuery, status: 'sold' });

    const ProductModel = getProductModel(productType);
    let productGeos = [];
    if (ProductModel) {
      const p = await ProductModel.findById(productId).select('geos');
      productGeos = (p?.geos || []).map(g => ({ code: g.code, counts: g.counts }));
    }

    return res.status(200).json({
      items,
      total,
      pages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      stats: { available, sold },
      productGeos
    });
  } catch (error) {
    console.error('[DigitalItem] list error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const downloadDigitalItem = async (req, res) => {
  try {
    const item = await DigitalItem.findOne({ uid: req.params.uid });
    if (!item) return res.status(404).json({ message: 'Item not found' });

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
    fs.createReadStream(item.filePath).pipe(res);
  } catch (error) {
    console.error('[DigitalItem] download error:', error);
    if (!res.headersSent) return res.status(500).json({ message: 'Server error' });
  }
};

export const deleteDigitalItem = async (req, res) => {
  try {
    const item = await DigitalItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    if (item.status === 'sold') {
      return res.status(400).json({ message: 'Cannot delete a sold item' });
    }

    if (isBunnyPath(item.filePath)) {
      await bunnyDelete(item.filePath);
    } else if (fs.existsSync(item.filePath)) {
      fs.unlinkSync(item.filePath);
    }

    await item.deleteOne();

    const newCount = await syncProductCounts(item.productId, item.productType);

    return res.status(200).json({ message: 'Item deleted', newCount });
  } catch (error) {
    console.error('[DigitalItem] delete error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const purchaseProduct = async (req, res) => {
  const { productId, productType, quantity = 1, geo } = req.body;
  const qty = Math.max(1, Math.min(50, parseInt(quantity) || 1));
  const customerId = req.customer._id;

  if (!mongoose.isValidObjectId(productId)) {
    return res.status(400).json({ message: 'Invalid product ID' });
  }

  const ProductModel = getProductModel(productType);
  if (!ProductModel) {
    return res.status(400).json({ message: 'Invalid product type' });
  }

  const product = await ProductModel.findById(productId);
  if (!product) return res.status(404).json({ message: 'Product not found' });

  const geoCode = String(geo || '').trim().toUpperCase();
  if (!geoCode || !isValidGeo(geoCode)) {
    return res.status(400).json({ message: 'Geo is required' });
  }
  const productGeoCodes = (product.geos || []).map(g => g.code);
  if (!productGeoCodes.includes(geoCode)) {
    return res.status(400).json({ message: `Geo ${geoCode} is not available for this product` });
  }

  const totalAmount = parseFloat((product.price * qty).toFixed(2));

  const customer = await CustomerUser.findOneAndUpdate(
    { _id: customerId, balance: { $gte: totalAmount } },
    { $inc: { balance: -totalAmount } },
    { returnDocument: 'after' }
  );

  if (!customer) {
    return res.status(400).json({ message: 'Insufficient balance' });
  }

  const reservedIds = [];
  try {
    for (let i = 0; i < qty; i++) {
      const item = await DigitalItem.findOneAndUpdate(
        { productId, productType, geo: geoCode, status: 'available' },
        { $set: { status: 'sold' } },
        { returnDocument: 'after' }
      );
      if (!item) {
        if (reservedIds.length > 0) {
          await DigitalItem.updateMany({ _id: { $in: reservedIds } }, { $set: { status: 'available', orderId: null } });
        }
        await CustomerUser.findByIdAndUpdate(customerId, { $inc: { balance: totalAmount } });
        return res.status(400).json({ message: `Only ${reservedIds.length} items available for ${geoCode}` });
      }
      reservedIds.push(item._id);
    }

    const titleRu = product.title?.ru || product.title?.en || product.name || '';
    const titleEn = product.title?.en || product.title?.ru || product.name || '';
    const titleStr = titleRu;
    const descStr = product.desc?.ru || product.desc?.en || '';

    const order = await Order.create({
      customerId,
      productId,
      productType,
      geo: geoCode,
      digitalItemId: reservedIds[0],
      digitalItemIds: reservedIds,
      quantity: qty,
      productSnapshot: {
        title: titleStr,
        description: descStr,
        productType,
        productSubType: product.type || '',
        price: product.price,
        image: product.path_image || product.image || '',
        geo: geoCode
      },
      amount: totalAmount,
      currency: 'USD',
      paymentMethod: 'balance',
      status: 'delivered',
      paidAt: new Date(),
      deliveredAt: new Date()
    });

    await DigitalItem.updateMany({ _id: { $in: reservedIds } }, { $set: { orderId: order._id } });

    await Transaction.create({
      userId: customerId,
      type: 'order',
      status: 'success',
      amount: -totalAmount,
      currency: 'USD',
      note: `Order ${order.uid} x${qty}`
    });

    await syncProductCounts(productId, productType);

    const notif = await Notification.create({
      userId: customerId,
      type: 'order_delivered',
      title: { ru: 'Товар доставлен', en: 'Product delivered' },
      message: {
        ru: `Вы приобрели: ${titleRu}${qty > 1 ? ` (x${qty})` : ''}`,
        en: `You purchased: ${titleEn}${qty > 1 ? ` (x${qty})` : ''}`
      },
      link: `/profile/orders?search=${order.uid}`
    });

    io.of('/customer').to(`customer:${customerId}`).emit('balance_updated', {
      balance: customer.balance
    });

    io.of('/customer').to(`customer:${customerId}`).emit('notification', {
      id: notif._id,
      type: notif.type,
      title: notif.title,
      message: notif.message,
      link: notif.link,
      createdAt: notif.createdAt
    });

    createAdminNotif({
      category: 'order',
      type: 'order_product',
      title: 'Новая покупка',
      message: `${customer.username} купил: ${titleStr}${qty > 1 ? ` (x${qty})` : ''} — $${totalAmount.toFixed(2)}`,
      link: `/orders?search=${encodeURIComponent(order.uid)}`,
      meta: { customerId, orderId: order._id, amount: totalAmount, orderUid: order.uid }
    });

    return res.status(200).json({
      message: 'Purchase successful',
      order: {
        uid: order.uid,
        status: order.status,
        amount: order.amount,
        quantity: order.quantity
      }
    });
  } catch (error) {
    if (reservedIds.length > 0) {
      await DigitalItem.updateMany({ _id: { $in: reservedIds } }, { $set: { status: 'available', orderId: null } }).catch(() => {});
    }
    await CustomerUser.findByIdAndUpdate(customerId, { $inc: { balance: totalAmount } }).catch(() => {});
    console.error('[DigitalItem] purchase error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
