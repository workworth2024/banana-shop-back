import express from 'express';
import { verifyToken, isAdmin } from '../../middlewares/authMiddleware.js';
import { getStats } from '../../controllers/healthController.js';

const router = express.Router();

router.get('/stats', verifyToken, isAdmin, getStats);

export default router;
