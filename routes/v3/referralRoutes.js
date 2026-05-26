import express from 'express';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import {
  getSettings,
  updateSettings,
  getMyReferralStats,
  getAllReferrers,
  getReferrerDetail,
  getCustomerRates,
  setCustomerRate,
  deleteCustomerRate,
  searchCustomersForRate
} from '../../controllers/referralController.js';

const router = express.Router();

router.get('/my-stats', verifyCustomer, getMyReferralStats);

router.get('/settings', verifyToken, getSettings);
router.put('/settings', verifyToken, updateSettings);
router.get('/referrers', verifyToken, getAllReferrers);
router.get('/referrers/:id', verifyToken, getReferrerDetail);

router.get('/customer-rates/search', verifyToken, searchCustomersForRate);
router.get('/customer-rates', verifyToken, getCustomerRates);
router.put('/customer-rates/:customerId', verifyToken, setCustomerRate);
router.delete('/customer-rates/:customerId', verifyToken, deleteCustomerRate);

export default router;
