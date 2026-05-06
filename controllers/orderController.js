import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import Order from '../models/Order.js';
import DigitalItem from '../models/DigitalItem.js';

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
      .select('-digitalItemId -digitalItemIds -accessKey');

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
    }).select('-digitalItemId -digitalItemIds');

    if (!order) return res.status(404).json({ message: 'Order not found' });

    return res.status(200).json({ order });
  } catch (error) {
    console.error('[Orders] getMyOrder error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const downloadMyItem = async (req, res) => {
  try {
    const order = await Order.findOne({
      uid: req.params.uid,
      customerId: req.customer._id,
      status: 'delivered'
    });

    if (!order) return res.status(404).json({ message: 'Order not found or not delivered' });

    const itemIds = order.digitalItemIds?.length ? order.digitalItemIds : (order.digitalItemId ? [order.digitalItemId] : []);

    if (!itemIds.length) return res.status(404).json({ message: 'No files in this order' });

    const items = await DigitalItem.find({ _id: { $in: itemIds } });
    const validItems = items.filter(i => fs.existsSync(i.filePath));

    if (!validItems.length) return res.status(404).json({ message: 'Files not found on disk' });

    if (validItems.length === 1) {
      const item = validItems[0];
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(item.originalName)}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', item.fileSize);
      return fs.createReadStream(item.filePath).pipe(res);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${order.uid}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error('[Orders] zip error:', err);
      if (!res.headersSent) res.status(500).end();
    });
    archive.pipe(res);

    for (const item of validItems) {
      archive.file(item.filePath, { name: item.originalName });
    }

    await archive.finalize();
  } catch (error) {
    console.error('[Orders] downloadMyItem error:', error);
    if (!res.headersSent) return res.status(500).json({ message: 'Server error' });
  }
};
