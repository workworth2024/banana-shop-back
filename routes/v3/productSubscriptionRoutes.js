import express from 'express';
import { getSubscriptionsSummary, getSubscribersForProduct } from '../../controllers/productSubscriptionController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';

const router = express.Router();

const canManage = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied' });
  }
};

router.get('/summary', verifyToken, canManage, getSubscriptionsSummary);
router.get('/', verifyToken, canManage, getSubscribersForProduct);

export default router;
