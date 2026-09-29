import express from 'express';
import { getSubscriptionStatus, subscribe, unsubscribe } from '../../controllers/productSubscriptionController.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';

const router = express.Router();

router.get('/status', verifyCustomer, getSubscriptionStatus);
router.post('/', verifyCustomer, subscribe);
router.delete('/', verifyCustomer, unsubscribe);

export default router;
