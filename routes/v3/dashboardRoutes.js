import express from 'express';
import { verifyToken, isAdmin } from '../../middlewares/authMiddleware.js';
import { getDashboard, getTop } from '../../controllers/dashboardController.js';

const router = express.Router();

router.get('/', verifyToken, isAdmin, getDashboard);
router.get('/top/:kind', verifyToken, isAdmin, getTop);

export default router;
