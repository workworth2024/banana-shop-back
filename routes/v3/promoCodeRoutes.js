import express from 'express';
import {
  listPromoCodes, getPromoCode, createPromoCode, updatePromoCode,
  setPromoCodeStatus, deletePromoCode, getPromoCodeRedemptions,
  getMyPromoCodes, redeemPromoCodeHandler, cancelActivePromoCodeHandler
} from '../../controllers/promoCodeController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';

const router = express.Router();

const canManage = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') return next();
  return res.status(403).json({ message: 'Access denied' });
};

// Customer-facing routes first, so literal paths like /my never get swallowed by /:id.
router.get('/my', verifyCustomer, getMyPromoCodes);
router.post('/redeem', verifyCustomer, redeemPromoCodeHandler);
router.post('/cancel-active', verifyCustomer, cancelActivePromoCodeHandler);

// Admin
router.get('/', verifyToken, canManage, listPromoCodes);
router.post('/', verifyToken, canManage, createPromoCode);
router.get('/:id', verifyToken, canManage, getPromoCode);
router.patch('/:id', verifyToken, canManage, updatePromoCode);
router.patch('/:id/status', verifyToken, canManage, setPromoCodeStatus);
router.delete('/:id', verifyToken, canManage, deletePromoCode);
router.get('/:id/redemptions', verifyToken, canManage, getPromoCodeRedemptions);

export default router;
