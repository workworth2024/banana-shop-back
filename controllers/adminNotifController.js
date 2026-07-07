import AdminNotification from '../models/AdminNotification.js';
import AdminNotifSettings from '../models/AdminNotifSettings.js';
import { io } from '../server.js';

const MAX_PER_CATEGORY = 100;

/** type из createAdminNotif → ключ enabled в AdminNotifSettings */
const TYPE_TO_TOGGLE_KEY = {
  order_product: 'order_product',
  order_preorder: 'order_preorder',
  order_service: 'order_service',
  replace_request: 'order_replacement',
  transaction_deposit: 'transaction_deposit',
  transaction_payment: 'transaction_payment',
  user_registration: 'user_registration',
  support_new_ticket: 'support_ticket'
};

async function adminWantsNotificationByType(notificationType) {
  const toggleKey = TYPE_TO_TOGGLE_KEY[notificationType];
  if (!toggleKey) return true;

  const docs = await AdminNotifSettings.find({}).select('enabled').lean();
  if (docs.length === 0) return true;

  return docs.some((d) => {
    const v = d.enabled?.[toggleKey];
    return v !== false;
  });
}

export const createAdminNotif = async ({ category, type, title, message, link = null, meta = {} }) => {
  try {
    const enabled = await adminWantsNotificationByType(type);
    if (!enabled) return;

    const notif = await AdminNotification.create({ category, type, title, message, link, meta });
    const count = await AdminNotification.countDocuments({ category });
    if (count > MAX_PER_CATEGORY) {
      const oldest = await AdminNotification.find({ category })
        .sort({ createdAt: 1 })
        .limit(count - MAX_PER_CATEGORY)
        .select('_id');
      await AdminNotification.deleteMany({ _id: { $in: oldest.map(o => o._id) } });
    }
    const unreadCount = await AdminNotification.countDocuments({ isRead: false });
    io.of('/admin').to('admins').emit('admin_notification', {
      id: notif._id,
      category: notif.category,
      type: notif.type,
      title: notif.title,
      message: notif.message,
      link: notif.link,
      createdAt: notif.createdAt,
      unreadCount,
      categoryUnreadCount: await AdminNotification.countDocuments({ category, isRead: false })
    });
  } catch (err) {
    console.error('[AdminNotif] createAdminNotif error:', err);
  }
};

export const getAdminNotifs = async (req, res) => {
  try {
    const { page = 1, limit = 30, category, isRead } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const query = {};
    if (category) query.category = category;
    if (isRead !== undefined && isRead !== '') query.isRead = isRead === 'true';

    const [items, total, unreadCount] = await Promise.all([
      AdminNotification.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      AdminNotification.countDocuments(query),
      AdminNotification.countDocuments({ isRead: false })
    ]);

    return res.status(200).json({ items, total, pages: Math.ceil(total / Number(limit)), unreadCount });
  } catch (err) {
    console.error('[AdminNotif] getAdminNotifs error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getAdminNotifCount = async (req, res) => {
  try {
    const unreadCount = await AdminNotification.countDocuments({ isRead: false });
    return res.status(200).json({ unreadCount });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getAdminNotifCategoryCounts = async (req, res) => {
  try {
    const rows = await AdminNotification.aggregate([
      { $match: { isRead: false } },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);
    const counts = {};
    rows.forEach((r) => { counts[r._id] = r.count; });
    return res.status(200).json({ counts });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const markCategoryRead = async (req, res) => {
  try {
    const { categories } = req.body;
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ message: 'categories is required' });
    }
    await AdminNotification.updateMany(
      { category: { $in: categories }, isRead: false },
      { $set: { isRead: true } }
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const markRead = async (req, res) => {
  try {
    await AdminNotification.findByIdAndUpdate(req.params.id, { isRead: true });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const markAllRead = async (req, res) => {
  try {
    await AdminNotification.updateMany({ isRead: false }, { $set: { isRead: true } });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const clearAll = async (req, res) => {
  try {
    const { category } = req.query;
    const query = category ? { category } : {};
    await AdminNotification.deleteMany(query);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getNotifSettings = async (req, res) => {
  try {
    let settings = await AdminNotifSettings.findOne({ adminId: req.user._id });
    if (!settings) {
      settings = await AdminNotifSettings.create({ adminId: req.user._id });
    }
    return res.status(200).json({ settings });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateNotifSettings = async (req, res) => {
  try {
    const { enabled } = req.body;
    const settings = await AdminNotifSettings.findOneAndUpdate(
      { adminId: req.user._id },
      { $set: { enabled } },
      { returnDocument: 'after', upsert: true }
    );
    return res.status(200).json({ settings });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};
