import express from 'express';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';
import {
  getMyNotifications,
  getUnreadCount,
  getUnreadBroadcasts,
  markAsRead,
  markAllAsRead
} from '../../controllers/notificationController.js';

const router = express.Router();

router.get('/', verifyCustomer, getMyNotifications);
router.get('/unread-count', verifyCustomer, getUnreadCount);
router.get('/unread-broadcasts', verifyCustomer, getUnreadBroadcasts);
router.patch('/:id/read', verifyCustomer, markAsRead);
router.patch('/read-all', verifyCustomer, markAllAsRead);

export default router;
