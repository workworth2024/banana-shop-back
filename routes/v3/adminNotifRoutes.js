import express from 'express';
import { verifyToken, isAdmin } from '../../middlewares/authMiddleware.js';
import {
  getAdminNotifs, getAdminNotifCount, markRead, markAllRead, clearAll,
  getNotifSettings, updateNotifSettings
} from '../../controllers/adminNotifController.js';

const router = express.Router();

router.get('/', verifyToken, getAdminNotifs);
router.get('/count', verifyToken, getAdminNotifCount);
router.patch('/:id/read', verifyToken, markRead);
router.patch('/mark-all-read', verifyToken, markAllRead);
router.delete('/clear', verifyToken, clearAll);
router.get('/settings', verifyToken, getNotifSettings);
router.patch('/settings', verifyToken, updateNotifSettings);

export default router;
