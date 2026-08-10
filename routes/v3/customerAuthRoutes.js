import express from 'express';
import rateLimit from 'express-rate-limit';
import { register, verifyRegistration, resendRegistrationCode, getCaptchaToken, requestEmailCode, confirmEmailCode, forgotPassword, resetPassword, login, logout, getMe, updateProfile, setup2FA, enable2FA, disable2FA, verifyLogin2FA, telegramCallback, telegramWebAppLogin, telegramMagicLogin, linkTelegram, unlinkTelegram } from '../../controllers/customerAuthController.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { message: 'Too many registration attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const twoFALimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many 2FA attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { message: 'Too many verification attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { message: 'Too many code requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/captcha', getCaptchaToken);
router.post('/register', registerLimiter, register);
router.post('/register/verify', verifyLimiter, verifyRegistration);
router.post('/register/resend', resendLimiter, resendRegistrationCode);
router.post('/email/request-code', verifyCustomer, resendLimiter, requestEmailCode);
router.post('/email/confirm', verifyCustomer, verifyLimiter, confirmEmailCode);
router.post('/password/forgot', resendLimiter, forgotPassword);
router.post('/password/reset', verifyLimiter, resetPassword);
router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.get('/me', verifyCustomer, getMe);
router.patch('/profile', verifyCustomer, updateProfile);
router.post('/2fa/verify-login', twoFALimiter, verifyLogin2FA);
router.post('/2fa/setup', verifyCustomer, setup2FA);
router.post('/2fa/enable', verifyCustomer, enable2FA);
router.post('/2fa/disable', verifyCustomer, disable2FA);
router.post('/telegram/callback', telegramCallback);
router.post('/telegram/webapp', loginLimiter, telegramWebAppLogin);
router.post('/telegram/magic', loginLimiter, telegramMagicLogin);
router.post('/telegram/link', verifyCustomer, linkTelegram);
router.delete('/telegram/link', verifyCustomer, unlinkTelegram);

export default router;
