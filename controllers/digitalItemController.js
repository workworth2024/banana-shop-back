import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import DigitalItem from '../models/DigitalItem.js';
import GoogleAdsProduct from '../models/GoogleAdsProduct.js';
import YoutubeProduct from '../models/YoutubeProduct.js';
import Order from '../models/Order.js';
import Notification from '../models/Notification.js';
import Transaction from '../models/Transaction.js';
import CustomerUser from '../models/CustomerUser.js';
import { io } from '../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const getProductModel = (productType) => {
  if (productType === 'GoogleAdsProduct') return GoogleAdsProduct;
  if (productType === 'YoutubeProduct') return YoutubeProduct;
  return null;
};

const syncProductCounts = async (productId, productType, session = null) => {
  const ProductModel = getProductModel(productType);
  if (!ProductModel) return;
  const opts = session ? { session } : {};
  const count = await DigitalItem.countDocuments({ productId, productType, status: 'available' }, opts);
  await ProductModel.findByIdAndUpdate(productId, { counts: count }, opts);
  return count;
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

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const items = req.files.map(file => ({
      productId,
      productType,
      filePath: file.path,
      originalName: file.originalname,
      fileSize: file.size
    }));

    await DigitalItem.insertMany(items);

    const newCount = await syncProductCounts(productId, productType);

    return res.status(201).json({
      message: `${items.length} file(s) uploaded`,
      uploaded: items.length,
      newCount
    });
  } catch (error) {
    console.error('[DigitalItem] upload error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getDigitalItems = async (req, res) => {
  try {
    const { productId, productType } = req.params;
    const { page = 1, limit = 20, status, search } = req.query;

    const query = { productId, productType };
    if (status) query.status = status;
    if (search) {
      const safe = String(search).slice(0, 100);
      query.$or = [
        { originalName: { $regex: safe, $options: 'i' } },
        { uid: { $regex: safe, $options: 'i' } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const items = await DigitalItem.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('-filePath');

    const total = await DigitalItem.countDocuments(query);
    const available = await DigitalItem.countDocuments({ productId, productType, status: 'available' });
    const sold = await DigitalItem.countDocuments({ productId, productType, status: 'sold' });

    return res.status(200).json({
      items,
      total,
      pages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      stats: { available, sold }
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

    if (!fs.existsSync(item.filePath)) {
      return res.status(404).json({ message: 'File not found on disk' });
    }

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(item.originalName)}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', item.fileSize);
    fs.createReadStream(item.filePath).pipe(res);
  } catch (error) {
    console.error('[DigitalItem] download error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const deleteDigitalItem = async (req, res) => {
  try {
    const item = await DigitalItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    if (item.status === 'sold') {
      return res.status(400).json({ message: 'Cannot delete a sold item' });
    }

    if (fs.existsSync(item.filePath)) {
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
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { productId, productType, quantity = 1 } = req.body;
    const qty = Math.max(1, Math.min(50, parseInt(quantity) || 1));
    const customerId = req.customer._id;

    if (!mongoose.isValidObjectId(productId)) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Invalid product ID' });
    }

    const ProductModel = getProductModel(productType);
    if (!ProductModel) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Invalid product type' });
    }

    const product = await ProductModel.findById(productId).session(session);
    if (!product) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Product not found' });
    }

    const totalAmount = parseFloat((product.price * qty).toFixed(2));

    const customer = await CustomerUser.findById(customerId).session(session);
    if (customer.balance < totalAmount) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    const availableCount = await DigitalItem.countDocuments({ productId, productType, status: 'available' }).session(session);
    if (availableCount < qty) {
      await session.abortTransaction();
      return res.status(400).json({ message: `Only ${availableCount} items available` });
    }

    const digitalItems = await DigitalItem.find(
      { productId, productType, status: 'available' },
      null,
      { session }
    ).limit(qty);

    const itemIds = digitalItems.map(i => i._id);
    await DigitalItem.updateMany({ _id: { $in: itemIds } }, { $set: { status: 'sold' } }, { session });

    const titleStr = product.title?.ru || product.title?.en || product.name || '';

    const [order] = await Order.create([{
      customerId,
      productId,
      productType,
      digitalItemId: itemIds[0],
      digitalItemIds: itemIds,
      quantity: qty,
      productSnapshot: {
        title: titleStr,
        price: product.price,
        image: product.path_image || product.image || ''
      },
      amount: totalAmount,
      currency: 'USD',
      paymentMethod: 'balance',
      status: 'delivered',
      paidAt: new Date(),
      deliveredAt: new Date()
    }], { session });

    await DigitalItem.updateMany({ _id: { $in: itemIds } }, { $set: { orderId: order._id } }, { session });

    const balanceBefore = customer.balance;
    customer.balance = parseFloat((customer.balance - totalAmount).toFixed(2));
    await customer.save({ session });

    await Transaction.create([{
      userId: customerId,
      type: 'order',
      status: 'success',
      amount: -totalAmount,
      currency: 'USD',
      note: `Order ${order.uid} x${qty}`
    }], { session });

    await syncProductCounts(productId, productType, session);

    const [notif] = await Notification.create([{
      userId: customerId,
      type: 'order_delivered',
      title: 'Товар доставлен',
      message: `Вы приобрели: ${titleStr}${qty > 1 ? ` (x${qty})` : ''}`,
      link: `/profile/orders/${order.uid}`
    }], { session });

    await session.commitTransaction();

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
    await session.abortTransaction();
    console.error('[DigitalItem] purchase error:', error);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    session.endSession();
  }
};
