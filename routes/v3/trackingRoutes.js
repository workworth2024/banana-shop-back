import express from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import {
  hit,
  listLinks,
  createLink,
  updateLink,
  deleteLink,
  getLinkStats,
  getDashboard
} from '../../controllers/trackingController.js';

const router = express.Router();

const hitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false }
});

// Public — fired by the storefront when a visitor lands via a smart link
router.post('/hit', hitLimiter, hit);

// CRM (staff)
router.get('/dashboard', verifyToken, getDashboard);
router.get('/links', verifyToken, listLinks);
router.post('/links', verifyToken, createLink);
router.patch('/links/:id', verifyToken, updateLink);
router.delete('/links/:id', verifyToken, deleteLink);
router.get('/links/:id/stats', verifyToken, getLinkStats);

export default router;
