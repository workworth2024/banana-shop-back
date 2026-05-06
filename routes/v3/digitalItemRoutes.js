import express from 'express';
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

// Admin: upload files for a product
router.post(
  '/admin/:productType/:productId',
  verifyToken,
  canManageDigital,
  uploadDigital.array('files', 100),
  uploadDigitalItems
);

// Admin: download a specific item by uid (must come BEFORE :productType/:productId)
router.get(
  '/admin/download/:uid',
  verifyToken,
  canManageDigital,
  downloadDigitalItem
);

// Admin: list digital items for a product
router.get(
  '/admin/:productType/:productId',
  verifyToken,
  canManageDigital,
  getDigitalItems
);

// Admin: delete an item by _id
router.delete(
  '/admin/:id',
  verifyToken,
  canManageDigital,
  deleteDigitalItem
);

// Customer: purchase a product (deducts balance, assigns digital item)
router.post(
  '/purchase',
  verifyCustomer,
  purchaseProduct
);

export default router;
