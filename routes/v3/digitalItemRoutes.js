import express from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';
import {
  uploadDigitalItems,
  getDigitalItems,
  downloadDigitalItem,
  deleteDigitalItem,
  purchaseProduct
} from '../../controllers/digitalItemController.js';
import uploadDigital from '../../middlewares/uploadDigitalMiddleware.js';

const router = express.Router();

const canManageDigital = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') return next();
  return res.status(403).json({ message: 'Access denied' });
};

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: 'Too many upload requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const adminDownloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { message: 'Too many download requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const purchaseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: 'Too many purchase requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.post(
  '/admin/:productType/:productId',
  verifyToken,
  canManageDigital,
  uploadLimiter,
  uploadDigital.array('files', 100),
  uploadDigitalItems
);

router.get(
  '/admin/download/:uid',
  verifyToken,
  canManageDigital,
  adminDownloadLimiter,
  downloadDigitalItem
);

router.get(
  '/admin/:productType/:productId',
  verifyToken,
  canManageDigital,
  getDigitalItems
);

router.delete(
  '/admin/:id',
  verifyToken,
  canManageDigital,
  deleteDigitalItem
);

router.post(
  '/purchase',
  verifyCustomer,
  purchaseLimiter,
  purchaseProduct
);

export default router;
