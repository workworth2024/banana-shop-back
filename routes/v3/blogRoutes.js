import express from 'express';
import {
  adminListBlogPosts, adminGetBlogPostById, adminCreateBlogPost, adminUpdateBlogPost,
  adminDeleteBlogPost, adminUploadBlogImage, adminImportFromTeletype
} from '../../controllers/blogController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import upload from '../../middlewares/uploadMiddleware.js';

const router = express.Router();

const canManageBlog = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') return next();
  return res.status(403).json({ success: false, message: 'Access denied: Blog management' });
};

router.get('/', verifyToken, canManageBlog, adminListBlogPosts);
router.post('/upload-image', verifyToken, canManageBlog, upload.single('image'), adminUploadBlogImage);
router.post('/import-teletype', verifyToken, canManageBlog, adminImportFromTeletype);
router.post('/', verifyToken, canManageBlog, upload.single('cover'), adminCreateBlogPost);
router.get('/:id', verifyToken, canManageBlog, adminGetBlogPostById);
router.put('/:id', verifyToken, canManageBlog, upload.single('cover'), adminUpdateBlogPost);
router.delete('/:id', verifyToken, canManageBlog, adminDeleteBlogPost);

export default router;
