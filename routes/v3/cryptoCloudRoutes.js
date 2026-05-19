import express from 'express';
import {
  createTopupInvoice,
  handlePostback,
  listMyInvoices,
  debugPing,
  checkoutProduct,
  checkoutCart,
  checkoutService
} from '../../controllers/cryptoCloudController.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';
import uploadServiceOrder from '../../middlewares/uploadServiceOrderMiddleware.js';

const router = express.Router();

router.get('/ping', debugPing);

router.post('/topup', verifyCustomer, createTopupInvoice);
router.post('/checkout/product', verifyCustomer, express.json({ limit: '50kb' }), checkoutProduct);
router.post('/checkout/cart', verifyCustomer, express.json({ limit: '200kb' }), checkoutCart);
router.post('/checkout/service', verifyCustomer, uploadServiceOrder.any(), checkoutService);
router.get('/my-invoices', verifyCustomer, listMyInvoices);

router.post(
  '/postback',
  express.urlencoded({ extended: true, limit: '200kb' }),
  express.json({ limit: '200kb' }),
  (req, _res, next) => {
    if (process.env.CRYPTOCLOUD_DEBUG !== '0') {
      console.log('[CryptoCloud] postback HIT', {
        method: req.method,
        url: req.originalUrl,
        ip: req.headers['x-forwarded-for'] || req.ip,
        contentType: req.headers['content-type'],
        contentLength: req.headers['content-length']
      });
    }
    next();
  },
  handlePostback
);

router.post(
  '/postback-test',
  express.urlencoded({ extended: true, limit: '200kb' }),
  express.json({ limit: '200kb' }),
  (req, res) => {
    console.log('[CryptoCloud] POSTBACK-TEST', {
      contentType: req.headers['content-type'],
      body: req.body,
      headers: req.headers
    });
    res.json({ ok: true, received: req.body });
  }
);

export default router;
