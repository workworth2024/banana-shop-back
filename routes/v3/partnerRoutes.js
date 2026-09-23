import express from 'express';
import {
  getPartners, getPartnerById, createPartner, updatePartner, deletePartner, uploadPartnerImage
} from '../../controllers/partnerController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import upload from '../../middlewares/uploadMiddleware.js';

const router = express.Router();

const canManagePartners = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Partners management' });
  }
};

router.get('/', verifyToken, canManagePartners, getPartners);
router.get('/:id', verifyToken, canManagePartners, getPartnerById);
router.post('/upload-image', verifyToken, canManagePartners, upload.single('image'), uploadPartnerImage);
router.post('/', verifyToken, canManagePartners, upload.single('image'), createPartner);
router.put('/:id', verifyToken, canManagePartners, upload.single('image'), updatePartner);
router.delete('/:id', verifyToken, canManagePartners, deletePartner);

export default router;
