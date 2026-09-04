import express from 'express';
import {
  uploadBroadcastImage, previewBroadcastAudience, listBroadcasts, getBroadcast,
  createBroadcast, cancelBroadcast, deleteBroadcast
} from '../../controllers/broadcastController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import upload from '../../middlewares/uploadMiddleware.js';

const router = express.Router();

const canManage = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') return next();
  return res.status(403).json({ message: 'Access denied' });
};

router.use(verifyToken, canManage);

router.post('/upload-image', upload.single('image'), uploadBroadcastImage);
router.post('/preview-audience', previewBroadcastAudience);

router.get('/', listBroadcasts);
router.post('/', createBroadcast);
router.get('/:id', getBroadcast);
router.post('/:id/cancel', cancelBroadcast);
router.delete('/:id', deleteBroadcast);

export default router;
