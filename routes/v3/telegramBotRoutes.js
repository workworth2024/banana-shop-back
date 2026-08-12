import express from 'express';
import rateLimit from 'express-rate-limit';
import { createTelegramMagicLink } from '../../controllers/customerAuthController.js';
import {
  ensureBotCustomer,
  getBotProfile,
  getBotLanguage,
  setBotLanguage,
  getBotWallet
} from '../../controllers/telegramBotController.js';
import { getMyOrders } from '../../controllers/orderController.js';
import { getMyPreorders } from '../../controllers/preorderController.js';
import { getMyWhitePages } from '../../controllers/whitePageController.js';
import { getMyReferralStats } from '../../controllers/referralController.js';
import { getMyNotifications } from '../../controllers/notificationController.js';
import { verifyBotInternal, resolveBotCustomer } from '../../middlewares/botInternalMiddleware.js';

const router = express.Router();

const botLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { message: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.use(verifyBotInternal, botLimiter);

router.post('/magic-link', createTelegramMagicLink);
router.post('/ensure', ensureBotCustomer);
router.get('/language', getBotLanguage);
router.patch('/language', resolveBotCustomer, setBotLanguage);

router.get('/profile', resolveBotCustomer, getBotProfile);
router.get('/wallet', resolveBotCustomer, getBotWallet);
router.get('/orders', resolveBotCustomer, getMyOrders);
router.get('/preorders', resolveBotCustomer, getMyPreorders);
router.get('/white-pages', resolveBotCustomer, getMyWhitePages);
router.get('/referral', resolveBotCustomer, getMyReferralStats);
router.get('/notifications', resolveBotCustomer, getMyNotifications);

export default router;
