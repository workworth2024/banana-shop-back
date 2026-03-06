import express from 'express';
import { 
  getManuals, createManual, updateManual, deleteManual 
} from '../../controllers/manualController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import upload from '../../middlewares/uploadMiddleware.js';

const router = express.Router();

const verifyPublicToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1]?.trim();
  const envToken = process.env.API_KEY?.trim();
  if (!token || !envToken || token !== envToken) {
    return res.status(401).json({ message: 'Unauthorized: Invalid token' });
  }
  next();
};

const canManageManuals = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Manuals management' });
  }
};

router.post('/', verifyToken, canManageManuals, upload.single('file'), createManual);
router.put('/:id', verifyToken, canManageManuals, upload.single('file'), updateManual);
router.delete('/:id', verifyToken, canManageManuals, deleteManual);

export default router;
