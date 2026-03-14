import express from 'express';
import {
  getPreorders, updatePreorderStatus, deletePreorder
} from '../../controllers/preorderController.js';
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

router.get('/', verifyToken, canManage, getPreorders);
router.put('/:id/status', verifyToken, canManage, updatePreorderStatus);
router.delete('/:id', verifyToken, canManage, deletePreorder);

export default router;
