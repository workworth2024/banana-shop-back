import express from 'express';
import {
  createServiceOrder, getMyServiceOrders, downloadResultFile,
  getAllServiceOrders, updateServiceOrderStatus,
  uploadResultFiles, deleteResultFile, downloadCustomerFile,
  processServiceOrderRefund
} from '../../controllers/serviceOrderController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';
import uploadServiceOrder from '../../middlewares/uploadServiceOrderMiddleware.js';

const router = express.Router();

const canManage = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') return next();
  return res.status(403).json({ message: 'Access denied' });
};

router.post('/', verifyCustomer, uploadServiceOrder.any(), createServiceOrder);
router.get('/my', verifyCustomer, getMyServiceOrders);
router.get('/my/:uid/download/:fileId', verifyCustomer, downloadResultFile);

router.get('/', verifyToken, canManage, getAllServiceOrders);
router.put('/:id/status', verifyToken, canManage, updateServiceOrderStatus);
router.post('/:id/refund', verifyToken, canManage, processServiceOrderRefund);
router.post('/:id/result-files', verifyToken, canManage, uploadServiceOrder.array('files', 50), uploadResultFiles);
router.delete('/:id/result-files/:fileId', verifyToken, canManage, deleteResultFile);
router.get('/:id/customer-files/:fileId/download', verifyToken, canManage, downloadCustomerFile);

export default router;
