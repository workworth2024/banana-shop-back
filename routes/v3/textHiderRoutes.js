import express from 'express';
import rateLimit from 'express-rate-limit';
import { analyzeText } from '../../controllers/textHiderController.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';

const router = express.Router();

// Each call costs money on AIMLAPI — cap abuse on top of requiring a login.
const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { available: false, error: 'Слишком много запросов. Попробуйте позже.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/analyze', verifyCustomer, analyzeLimiter, analyzeText);

export default router;
