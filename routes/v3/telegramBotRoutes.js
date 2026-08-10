import express from 'express';
import rateLimit from 'express-rate-limit';
import { createTelegramMagicLink } from '../../controllers/customerAuthController.js';
import { verifyBotInternal } from '../../middlewares/botInternalMiddleware.js';

const router = express.Router();

const magicLinkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { message: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/magic-link', verifyBotInternal, magicLinkLimiter, createTelegramMagicLink);

export default router;
