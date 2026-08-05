import express from 'express';
import { getOrderHistory, getOrderHistoryFilters } from '../../controllers/orderHistoryController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';

const router = express.Router();

const canManage = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') return next();
  return res.status(403).json({ message: 'Access denied' });
};

router.get('/', verifyToken, canManage, getOrderHistory);
router.get('/filters', verifyToken, canManage, getOrderHistoryFilters);

export default router;
