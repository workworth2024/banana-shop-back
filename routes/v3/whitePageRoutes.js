import express from 'express';
import {
  getPrice, createWhitePage, getMyWhitePages, getWhitePageDetail,
  mintWhitePageDownload, regenerateWhitePage, retryWhitePage
} from '../../controllers/whitePageController.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';

const router = express.Router();

router.get('/price', verifyCustomer, getPrice);
router.post('/', verifyCustomer, createWhitePage);
router.get('/my', verifyCustomer, getMyWhitePages);
router.get('/my/:uniqueId', verifyCustomer, getWhitePageDetail);
router.post('/my/:uniqueId/download', verifyCustomer, mintWhitePageDownload);
router.post('/my/:uniqueId/regenerate', verifyCustomer, regenerateWhitePage);
router.post('/my/:uniqueId/retry', verifyCustomer, retryWhitePage);

export default router;
