import express from 'express';
import { login, register, logout, checkAuth } from '../../controllers/authController.js';
import { verifyToken, isAdmin } from '../../middlewares/authMiddleware.js';

const router = express.Router();

// Public auth routes
router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);

// Protected auth check
router.get('/me', verifyToken, checkAuth);

// Admin-only: manage users
// router.get('/users/pending', verifyToken, isAdmin, getPendingUsers);
// router.put('/users/:id/approve', verifyToken, isAdmin, approveUser);

export default router;
