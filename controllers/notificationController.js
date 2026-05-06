import Notification from '../models/Notification.js';

export const getMyNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const userId = req.customer._id;

    const skip = (Number(page) - 1) * Number(limit);

    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Notification.countDocuments({ userId });
    const unread = await Notification.countDocuments({ userId, isRead: false });

    return res.status(200).json({
      notifications,
      total,
      pages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      unread
    });
  } catch (error) {
    console.error('[Notifications] getMyNotifications error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const unread = await Notification.countDocuments({
      userId: req.customer._id,
      isRead: false
    });
    return res.status(200).json({ unread });
  } catch (error) {
    console.error('[Notifications] getUnreadCount error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const notif = await Notification.findOne({
      _id: req.params.id,
      userId: req.customer._id
    });

    if (!notif) return res.status(404).json({ message: 'Notification not found' });

    notif.isRead = true;
    await notif.save();

    return res.status(200).json({ message: 'Marked as read' });
  } catch (error) {
    console.error('[Notifications] markAsRead error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.customer._id, isRead: false },
      { $set: { isRead: true } }
    );
    return res.status(200).json({ message: 'All marked as read' });
  } catch (error) {
    console.error('[Notifications] markAllAsRead error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
