import express from 'express';
import { 
  getFilters, createFilter, updateFilter, deleteFilter 
} from '../../controllers/filterController.js';
import { 
  getYoutubeProducts, createYoutubeProduct, updateYoutubeProduct, deleteYoutubeProduct,
  getGoogleAdsProducts, createGoogleAdsProduct, updateGoogleAdsProduct, deleteGoogleAdsProduct,
  getYoutubePositions, reorderYoutubeProducts, getGoogleAdsPositions, reorderGoogleAdsProducts
} from '../../controllers/productController.js';
import { verifyToken, hasAccess } from '../../middlewares/authMiddleware.js';
import upload from '../../middlewares/uploadMiddleware.js';

const router = express.Router();

// Role-based access: admin or manager
const canManageProducts = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Products management' });
  }
};

// Filters
router.get('/filters', verifyToken, getFilters);
router.post('/filters', verifyToken, canManageProducts, createFilter);
router.put('/filters/:id', verifyToken, canManageProducts, updateFilter);
router.delete('/filters/:id', verifyToken, canManageProducts, deleteFilter);

// Youtube Products
router.get('/youtube', verifyToken, getYoutubeProducts);
router.get('/youtube/positions', verifyToken, getYoutubePositions);
router.patch('/youtube/positions', verifyToken, canManageProducts, reorderYoutubeProducts);
router.post('/youtube', verifyToken, canManageProducts, upload.single('image'), createYoutubeProduct);
router.put('/youtube/:id', verifyToken, canManageProducts, upload.single('image'), updateYoutubeProduct);
router.delete('/youtube/:id', verifyToken, canManageProducts, deleteYoutubeProduct);

// Google Ads Products
router.get('/google-ads', verifyToken, getGoogleAdsProducts);
router.get('/google-ads/positions', verifyToken, getGoogleAdsPositions);
router.patch('/google-ads/positions', verifyToken, canManageProducts, reorderGoogleAdsProducts);
router.post('/google-ads', verifyToken, canManageProducts, upload.array('images', 8), createGoogleAdsProduct);
router.put('/google-ads/:id', verifyToken, canManageProducts, upload.array('images', 8), updateGoogleAdsProduct);
router.delete('/google-ads/:id', verifyToken, canManageProducts, deleteGoogleAdsProduct);

export default router;
