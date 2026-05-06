import express from 'express';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';
import { getMyOrders, getMyOrder, downloadMyItem } from '../../controllers/orderController.js';

const router = express.Router();

router.get('/my', verifyCustomer, getMyOrders);
router.get('/my/:uid', verifyCustomer, getMyOrder);
router.get('/my/:uid/download', verifyCustomer, downloadMyItem);

export default router;
