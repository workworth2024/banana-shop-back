import express from 'express';
import rateLimit from 'express-rate-limit';
import { login, register, logout, checkAuth } from '../../controllers/authController.js';
import { verifyToken, isAdmin } from '../../middlewares/authMiddleware.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Public auth routes
router.post('/register', register);
router.post('/login', loginLimiter, login);
router.post('/logout', logout);

// Protected auth check
router.get('/me', verifyToken, checkAuth);

// Admin-only: manage users
// router.get('/users/pending', verifyToken, isAdmin, getPendingUsers);
// router.put('/users/:id/approve', verifyToken, isAdmin, approveUser);

export default router;
