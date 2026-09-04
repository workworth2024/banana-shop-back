import express from 'express';
import {
  getSegmentFields, previewSegmentCount, listSegments, getSegment,
  createSegment, updateSegment, recomputeSegment, deleteSegment, getSegmentMembers,
  searchSegmentProducts
} from '../../controllers/segmentController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';

const router = express.Router();

const canManage = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') return next();
  return res.status(403).json({ message: 'Access denied' });
};

router.use(verifyToken, canManage);

router.get('/fields', getSegmentFields);
router.get('/products', searchSegmentProducts);
router.post('/preview', previewSegmentCount);

router.get('/', listSegments);
router.post('/', createSegment);
router.get('/:id', getSegment);
router.patch('/:id', updateSegment);
router.post('/:id/recompute', recomputeSegment);
router.delete('/:id', deleteSegment);
router.get('/:id/members', getSegmentMembers);

export default router;
