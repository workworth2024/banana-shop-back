import express from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';
import {
  getMyOrders,
  getMyOrder,
  downloadMyItemFile,
  getAllOrders,
  updateOrderStatus,
  deleteOrder
} from '../../controllers/orderController.js';
import {
  submitReplaceRequest,
  getMyReplaceRequest,
  getOrderReplaceRequest,
  downloadReplaceRequestPhoto,
  getAvailableItemsForOrder,
  processReplacement,
  processRefund,
  getReplacementsHistory
} from '../../controllers/replaceController.js';
import uploadReplace from '../../middlewares/uploadReplaceMiddleware.js';

const router = express.Router();

const customerDownloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { message: 'Too many download requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const canManageOrders = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') return next();
  return res.status(403).json({ message: 'Access denied' });
};

router.get('/my', verifyCustomer, getMyOrders);
router.get('/my/:uid', verifyCustomer, getMyOrder);
router.get('/my/:uid/download/:itemUid', verifyCustomer, customerDownloadLimiter, downloadMyItemFile);
router.post('/my/:uid/replace-request', verifyCustomer, uploadReplace.array('photos', 3), submitReplaceRequest);
router.get('/my/:uid/replace-request', verifyCustomer, getMyReplaceRequest);

router.get('/replacements', verifyToken, canManageOrders, getReplacementsHistory);
router.get('/', verifyToken, canManageOrders, getAllOrders);
router.patch('/:id/status', verifyToken, canManageOrders, updateOrderStatus);
router.delete('/:id', verifyToken, canManageOrders, deleteOrder);
router.get('/:id/replace-request', verifyToken, canManageOrders, getOrderReplaceRequest);
router.get('/:id/replace-photos/:photoIndex', verifyToken, canManageOrders, downloadReplaceRequestPhoto);
router.get('/:id/available-items', verifyToken, canManageOrders, getAvailableItemsForOrder);
router.post('/:id/replacement', verifyToken, canManageOrders, processReplacement);
router.post('/:id/refund', verifyToken, canManageOrders, processRefund);

export default router;
