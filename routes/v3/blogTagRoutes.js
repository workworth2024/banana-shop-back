import express from 'express';
import {
  getBlogTags, createBlogTag, updateBlogTag, deleteBlogTag
} from '../../controllers/blogTagController.js';
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

router.get('/', verifyToken, canManage, getBlogTags);
router.post('/', verifyToken, canManage, createBlogTag);
router.put('/:id', verifyToken, canManage, updateBlogTag);
router.delete('/:id', verifyToken, canManage, deleteBlogTag);

export default router;
