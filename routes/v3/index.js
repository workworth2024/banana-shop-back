import express from 'express';
import authRoutes from './authRoutes.js';
import customerAuthRoutes from './customerAuthRoutes.js';
import customerRoutes from './customerRoutes.js';
import customerWalletRoutes from './customerWalletRoutes.js';
import userRoutes from './userRoutes.js';
import productRoutes from './productRoutes.js';
import serviceRoutes from './serviceRoutes.js';
import manualRoutes from './manualRoutes.js';
import manualTagRoutes from './manualTagRoutes.js';
import reviewRoutes from './reviewRoutes.js';
import contactFormRoutes from './contactFormRoutes.js';
import preorderRoutes from './preorderRoutes.js';
import digitalItemRoutes from './digitalItemRoutes.js';
import orderRoutes from './orderRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import healthRoutes from './healthRoutes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/customer/auth', customerAuthRoutes);
router.use('/customer/wallet', customerWalletRoutes);
router.use('/customers', customerRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/services', serviceRoutes);
router.use('/manuals', manualRoutes);
router.use('/manual-tags', manualTagRoutes);
router.use('/reviews', reviewRoutes);
router.use('/contact-forms', contactFormRoutes);
router.use('/preorders', preorderRoutes);
router.use('/digital-items', digitalItemRoutes);
router.use('/orders', orderRoutes);
router.use('/notifications', notificationRoutes);
router.use('/health', healthRoutes);

export default router;
