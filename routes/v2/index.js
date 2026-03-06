import express from 'express';
import serviceRoutes from './serviceRoutes.js';
import productRoutes from './productRoutes.js';
import youtubeRoutes from './youtubeRoutes.js';
import manualRoutes from './manualRoutes.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Welcome to Client API v2' });
});

router.use('/services', serviceRoutes);
router.use('/products', productRoutes);
router.use('/youtube', youtubeRoutes);
router.use('/manuals', manualRoutes);

export default router;
