import express from 'express';
import {
  getReviews, createReview, updateReview, deleteReview
} from '../../controllers/reviewController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import upload from '../../middlewares/uploadMiddleware.js';

const router = express.Router();

const canManageReviews = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Reviews management' });
  }
};

router.get('/', verifyToken, canManageReviews, getReviews);
router.post('/', verifyToken, canManageReviews, upload.single('image'), createReview);
router.put('/:id', verifyToken, canManageReviews, upload.single('image'), updateReview);
router.delete('/:id', verifyToken, canManageReviews, deleteReview);

export default router;
