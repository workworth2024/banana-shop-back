import express from 'express';
import rateLimit from 'express-rate-limit';
import { createTelegramMagicLink } from '../../controllers/customerAuthController.js';
import {
  ensureBotCustomer,
  getBotProfile,
  getBotLanguage,
  setBotLanguage,
  getBotWallet,
  getBotWalletHistory
} from '../../controllers/telegramBotController.js';
import { createTopupInvoice, checkoutProduct, checkoutPreorder } from '../../controllers/cryptoCloudController.js';
import { purchaseProduct } from '../../controllers/digitalItemController.js';
import { getMyOrders, getMyOrder, downloadMyItemFile } from '../../controllers/orderController.js';
import { submitReplaceRequest } from '../../controllers/replaceController.js';
import { getMyPreorders, downloadMyPreorderFile, createPreorder } from '../../controllers/preorderController.js';
import { getMyWhitePages, getWhitePageDetail, downloadWhitePageFile } from '../../controllers/whitePageController.js';
import { getMyServiceOrders, downloadResultFile } from '../../controllers/serviceOrderController.js';
import { getMyReferralStats } from '../../controllers/referralController.js';
import { getMyNotifications } from '../../controllers/notificationController.js';
import { getMyPromoCodes, redeemPromoCodeHandler, cancelActivePromoCodeHandler } from '../../controllers/promoCodeController.js';
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
router.get('/wallet/history', resolveBotCustomer, getBotWalletHistory);
router.post('/wallet/topup', resolveBotCustomer, createTopupInvoice);

router.get('/orders', resolveBotCustomer, getMyOrders);
router.get('/orders/:uid', resolveBotCustomer, getMyOrder);
router.get('/orders/:uid/download/:itemUid', resolveBotCustomer, downloadMyItemFile);
router.post('/orders/:uid/replace', resolveBotCustomer, submitReplaceRequest);

// Catalog purchase flow — same controllers the storefront's BuyModal / preorder form use.
router.post('/purchase', resolveBotCustomer, purchaseProduct);
router.post('/checkout/product', resolveBotCustomer, checkoutProduct);
router.post('/preorder', resolveBotCustomer, createPreorder);
router.post('/checkout/preorder', resolveBotCustomer, checkoutPreorder);

router.get('/preorders', resolveBotCustomer, getMyPreorders);
router.get('/preorders/:uid/download/:fileId', resolveBotCustomer, downloadMyPreorderFile);

router.get('/white-pages', resolveBotCustomer, getMyWhitePages);
router.get('/white-pages/:uniqueId', resolveBotCustomer, getWhitePageDetail);
router.get('/white-pages/:uniqueId/download', resolveBotCustomer, downloadWhitePageFile);

router.get('/service-orders', resolveBotCustomer, getMyServiceOrders);
router.get('/service-orders/:uid/download/:fileId', resolveBotCustomer, downloadResultFile);

router.get('/referral', resolveBotCustomer, getMyReferralStats);
router.get('/notifications', resolveBotCustomer, getMyNotifications);

router.get('/promo', resolveBotCustomer, getMyPromoCodes);
router.post('/promo/redeem', resolveBotCustomer, redeemPromoCodeHandler);
router.post('/promo/cancel', resolveBotCustomer, cancelActivePromoCodeHandler);

export default router;
