import express from 'express';
import {
  getTemplates, createTemplate, updateTemplate, deleteTemplate
} from '../../controllers/templateController.js';
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

router.get('/', verifyToken, canManage, getTemplates);
router.post('/', verifyToken, canManage, createTemplate);
router.put('/:id', verifyToken, canManage, updateTemplate);
router.delete('/:id', verifyToken, canManage, deleteTemplate);

export default router;
