import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  login, register, logout, checkAuth,
  verifyLogin2FA, getSessions, terminateOtherSessions,
  setup2FA, enable2FA, disable2FA
} from '../../controllers/authController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/register', register);
router.post('/login', loginLimiter, login);
router.post('/2fa/verify-login', loginLimiter, verifyLogin2FA);
router.post('/logout', logout);

router.get('/me', verifyToken, checkAuth);

router.get('/sessions', verifyToken, getSessions);
router.delete('/sessions/others', verifyToken, terminateOtherSessions);

router.post('/2fa/setup', verifyToken, setup2FA);
router.post('/2fa/enable', verifyToken, enable2FA);
router.post('/2fa/disable', verifyToken, disable2FA);

export default router;
