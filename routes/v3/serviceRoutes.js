import express from 'express';
import { 
  getServices, createService, updateService, deleteService 
} from '../../controllers/serviceController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import upload from '../../middlewares/uploadMiddleware.js';

const router = express.Router();

const canManageServices = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Services management' });
  }
};

router.get('/', verifyToken, canManageServices, getServices);
router.post('/', verifyToken, canManageServices, upload.single('image'), createService);
router.put('/:id', verifyToken, canManageServices, upload.single('image'), updateService);
router.delete('/:id', verifyToken, canManageServices, deleteService);

export default router;
