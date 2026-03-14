import express from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import productRoutes from './productRoutes.js';
import serviceRoutes from './serviceRoutes.js';
import manualRoutes from './manualRoutes.js';
import reviewRoutes from './reviewRoutes.js';
import contactFormRoutes from './contactFormRoutes.js';
import preorderRoutes from './preorderRoutes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/services', serviceRoutes);
router.use('/manuals', manualRoutes);
router.use('/reviews', reviewRoutes);
router.use('/contact-forms', contactFormRoutes);
router.use('/preorders', preorderRoutes);

export default router;
