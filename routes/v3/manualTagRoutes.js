import express from 'express';
import {
  getManualTags, createManualTag, updateManualTag, deleteManualTag
} from '../../controllers/manualTagController.js';
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

router.get('/', verifyToken, canManage, getManualTags);
router.post('/', verifyToken, canManage, createManualTag);
router.put('/:id', verifyToken, canManage, updateManualTag);
router.delete('/:id', verifyToken, canManage, deleteManualTag);

export default router;
