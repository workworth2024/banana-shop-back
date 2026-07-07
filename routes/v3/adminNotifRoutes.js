import express from 'express';
import { verifyToken, isAdmin } from '../../middlewares/authMiddleware.js';
import {
  getAdminNotifs, getAdminNotifCount, getAdminNotifCategoryCounts, markRead, markAllRead, markCategoryRead, clearAll,
  getNotifSettings, updateNotifSettings
} from '../../controllers/adminNotifController.js';

const router = express.Router();

router.get('/', verifyToken, getAdminNotifs);
router.get('/count', verifyToken, getAdminNotifCount);
router.get('/category-counts', verifyToken, getAdminNotifCategoryCounts);
router.patch('/:id/read', verifyToken, markRead);
router.patch('/mark-all-read', verifyToken, markAllRead);
router.patch('/mark-category-read', verifyToken, markCategoryRead);
router.delete('/clear', verifyToken, clearAll);
router.get('/settings', verifyToken, getNotifSettings);
router.patch('/settings', verifyToken, updateNotifSettings);

export default router;
