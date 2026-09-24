import express from 'express';
import {
  getPartnerTags, createPartnerTag, updatePartnerTag, deletePartnerTag
} from '../../controllers/partnerTagController.js';
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

router.get('/', verifyToken, canManage, getPartnerTags);
router.post('/', verifyToken, canManage, createPartnerTag);
router.put('/:id', verifyToken, canManage, updatePartnerTag);
router.delete('/:id', verifyToken, canManage, deletePartnerTag);

export default router;
