import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getAnalyzerLimits,
  runAnalyzerScan,
  getMyAnalyses,
  getMyAnalysis
} from '../../controllers/analyzerController.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';

const router = express.Router();

// Abuse guard on top of the daily/bonus quota — scans call several paid external APIs.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { message: 'Too many scan requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/limits', verifyCustomer, getAnalyzerLimits);
router.post('/scan', verifyCustomer, scanLimiter, runAnalyzerScan);
router.get('/history', verifyCustomer, getMyAnalyses);
router.get('/history/:uid', verifyCustomer, getMyAnalysis);

export default router;
