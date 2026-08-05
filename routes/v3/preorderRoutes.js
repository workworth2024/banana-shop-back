import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  createPreorder,
  getPreorders, updatePreorderStatus, deletePreorder,
  uploadPreorderFiles, deletePreorderFile,
  getMyPreorders, downloadMyPreorderFile,
  processPreorderRefund
} from '../../controllers/preorderController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';
import uploadPreorder from '../../middlewares/uploadPreorderMiddleware.js';

const router = express.Router();

const canManage = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') return next();
  return res.status(403).json({ message: 'Access denied' });
};

const preorderCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { message: 'Too many preorder requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/my', verifyCustomer, getMyPreorders);
router.get('/my/:uid/download/:fileId', verifyCustomer, downloadMyPreorderFile);

router.post('/', verifyCustomer, preorderCreateLimiter, createPreorder);

router.get('/', verifyToken, canManage, getPreorders);
router.put('/:id/status', verifyToken, canManage, updatePreorderStatus);
router.post('/:id/refund', verifyToken, canManage, processPreorderRefund);
router.post('/:id/files', verifyToken, canManage, uploadPreorder.array('files', 50), uploadPreorderFiles);
router.delete('/:id/files/:fileId', verifyToken, canManage, deletePreorderFile);
router.delete('/:id', verifyToken, canManage, deletePreorder);

export default router;
