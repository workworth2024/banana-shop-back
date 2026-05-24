import express from 'express';
import { getCustomers, getCustomer, updateCustomerStatus, adjustBalance, resetCustomerPassword, getAdminTransactions, setCustomerReferrer } from '../../controllers/customerController.js';
import { verifyToken, isAdmin } from '../../middlewares/authMiddleware.js';

const router = express.Router();

router.get('/', verifyToken, getCustomers);
router.get('/admin/transactions', verifyToken, getAdminTransactions);
router.get('/:id', verifyToken, getCustomer);
router.patch('/:id/status', verifyToken, isAdmin, updateCustomerStatus);
router.patch('/:id/balance', verifyToken, isAdmin, adjustBalance);
router.patch('/:id/password', verifyToken, isAdmin, resetCustomerPassword);
router.patch('/:id/referrer', verifyToken, isAdmin, setCustomerReferrer);

export default router;
