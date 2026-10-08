import express from 'express';
import serviceRoutes from './serviceRoutes.js';
import productRoutes from './productRoutes.js';
import youtubeRoutes from './youtubeRoutes.js';
import manualRoutes from './manualRoutes.js';
import manualTagRoutes from './manualTagRoutes.js';
import reviewRoutes from './reviewRoutes.js';
import contactFormRoutes from './contactFormRoutes.js';
import preorderRoutes from './preorderRoutes.js';
import teamRoutes from './teamRoutes.js';
import partnerRoutes from './partnerRoutes.js';
import partnerTagRoutes from './partnerTagRoutes.js';
import whitePageRoutes from './whitePageRoutes.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Welcome to Client API v2' });
});

router.use('/services', serviceRoutes);
router.use('/products', productRoutes);
router.use('/youtube', youtubeRoutes);
router.use('/manuals', manualRoutes);
router.use('/manual-tags', manualTagRoutes);
router.use('/reviews', reviewRoutes);
router.use('/contact-forms', contactFormRoutes);
router.use('/preorders', preorderRoutes);
router.use('/team', teamRoutes);
router.use('/partners', partnerRoutes);
router.use('/partner-tags', partnerTagRoutes);
router.use('/white-pages', whitePageRoutes);

export default router;
