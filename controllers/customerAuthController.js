import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import CustomerUser from '../models/CustomerUser.js';
import CustomerSession from '../models/CustomerSession.js';
import PendingRegistration from '../models/PendingRegistration.js';
import TelegramLoginToken from '../models/TelegramLoginToken.js';
import { createAdminNotif } from './adminNotifController.js';
import { attachAcquisition } from '../utils/tracking.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../utils/mailer.js';

const COOKIE_NAME = 'customer_token';
const JWT_EXPIRES_IN = '7d';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 6;

const generateCode = () => String(Math.floor(100000 + Math.random() * 900000));

const isInternalEmail = (email) => /@banana\.internal$/i.test(String(email || ''));

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));

const generateToken = (id) => {
  return jwt.sign({ id, type: 'customer' }, process.env.JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
};

const setAuthCookie = (res, token) => {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE
  });
};

// Telegram-аватарки отдаём через свой origin (/tgpic/ проксируется nginx на t.me):
// прямые ссылки на t.me часто блокируются провайдерами и умирают по hotlink-политике
const telegramAvatarPath = (photoUrl) => {
  const match = /^https:\/\/t\.me\/i\/userpic\/([A-Za-z0-9._/-]+)$/.exec(String(photoUrl || ''));
  if (!match || match[1].includes('..')) return '';
  return `/tgpic/${match[1]}`;
};

const safeUser = (user) => {
  const internal = isInternalEmail(user.email);
  return {
    id: user._id,
    uid: user.uid,
    username: user.username,
    email: internal ? '' : user.email,
    emailVerified: !internal && user.verifemail !== false,
    telegramUsername: user.telegramUsername,
    telegramLinked: !!user.telegramId,
    telegramPhotoUrl: user.telegramPhotoUrl || '',
    avatarUrl: telegramAvatarPath(user.telegramPhotoUrl),
    balance: user.balance,
    bonusBalance: user.bonusBalance || 0,
    referralCode: user.referralCode,
    twoFAEnabled: user.twoFAEnabled,
    verifemail: user.verifemail !== false,
    language: user.language || 'en'
  };
};

const verifyTelegramData = (data) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  const authData = { ...data };
  const checkHash = authData.hash;
  delete authData.hash;

  const dataCheckArr = [];
  for (const key of Object.keys(authData).sort()) {
    if (authData[key] !== undefined && authData[key] !== null && authData[key] !== '') {
      dataCheckArr.push(`${key}=${authData[key]}`);
    }
  }
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (hash !== checkHash) return false;

  const now = Math.floor(Date.now() / 1000);
  if (now - Number(authData.auth_date) > 600) return false;

  return true;
};

export const getCaptchaToken = async (req, res) => {
  try {
    const token = jwt.sign({ type: 'captcha' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    return res.status(200).json({ captchaToken: token });
  } catch (error) {
    console.error('[CustomerAuth] getCaptchaToken error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

const verifyCaptchaToken = (token) => {
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.type === 'captcha';
  } catch {
    return false;
  }
};

export const register = async (req, res) => {
  try {
    const { username, email, password, telegramUsername, referralCode, captchaToken } = req.body;

    if (!verifyCaptchaToken(captchaToken)) {
      return res.status(400).json({ message: 'Captcha verification required' });
    }

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Username, email and password are required' });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ message: 'Username must be 3–30 characters' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ message: 'Username may only contain letters, numbers and underscores' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim();

    const existing = await CustomerUser.findOne({
      $or: [{ username: normalizedUsername }, { email: normalizedEmail }]
    });
    if (existing) {
      return res.status(409).json({ message: 'Username or email already in use' });
    }

    const usernameTakenInPending = await PendingRegistration.findOne({
      username: normalizedUsername,
      email: { $ne: normalizedEmail }
    });
    if (usernameTakenInPending) {
      return res.status(409).json({ message: 'Username or email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const code = generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + PENDING_TTL_MS);

    await PendingRegistration.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        username: normalizedUsername,
        password: hashedPassword,
        telegramUsername: telegramUsername?.trim() || null,
        referralCode: referralCode || null,
        trackingCode: req.body?.trackingCode || null,
        codeHash,
        attempts: 0,
        expiresAt
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const sent = await sendVerificationEmail(normalizedEmail, code);
    if (!sent) {
      return res.status(502).json({ message: 'Could not send verification email. Please try again later.' });
    }

    return res.status(200).json({
      message: 'Verification code sent',
      requiresVerification: true,
      email: normalizedEmail
    });
  } catch (error) {
    console.error('[CustomerAuth] register error:', error);
    return res.status(500).json({ message: 'Server error during registration' });
  }
};

export const verifyRegistration = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ message: 'Email and code are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const pending = await PendingRegistration.findOne({ email: normalizedEmail });

    if (!pending || pending.expiresAt < new Date()) {
      if (pending) await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).json({ message: 'Verification code expired. Please register again.' });
    }

    if (pending.attempts >= MAX_VERIFY_ATTEMPTS) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(429).json({ message: 'Too many attempts. Please register again.' });
    }

    const isMatch = await bcrypt.compare(String(code).trim(), pending.codeHash);
    if (!isMatch) {
      pending.attempts += 1;
      await pending.save();
      return res.status(401).json({ message: 'Invalid verification code' });
    }

    const conflict = await CustomerUser.findOne({
      $or: [{ username: pending.username }, { email: pending.email }]
    });
    if (conflict) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(409).json({ message: 'Username or email already in use' });
    }

    let referredByUser = null;
    if (pending.referralCode) {
      referredByUser = await CustomerUser.findOne({ referralCode: pending.referralCode.toUpperCase() });
    }

    const newUser = await CustomerUser.create({
      username: pending.username,
      email: pending.email,
      password: pending.password,
      telegramUsername: pending.telegramUsername || null,
      referredBy: referredByUser?._id || null,
      verifemail: true
    });

    await PendingRegistration.deleteOne({ _id: pending._id });

    const token = generateToken(newUser._id);
    const expire = new Date(Date.now() + COOKIE_MAX_AGE);

    await CustomerSession.create({
      userId: newUser._id,
      token,
      expire,
      ip: req.ip,
      device: req.headers['user-agent']
    });

    setAuthCookie(res, token);

    createAdminNotif({
      category: 'user',
      type: 'user_registration',
      title: 'Новая регистрация',
      message: `Зарегистрировался новый пользователь: ${newUser.username}`,
      link: `/clients?search=${encodeURIComponent(newUser.uid)}`,
      meta: { customerId: newUser._id, username: newUser.username, uid: newUser.uid }
    });

    attachAcquisition({ user: newUser, code: pending.trackingCode, req }).catch(() => {});

    return res.status(201).json({
      message: 'Account created successfully',
      user: safeUser(newUser)
    });
  } catch (error) {
    console.error('[CustomerAuth] verifyRegistration error:', error);
    return res.status(500).json({ message: 'Server error during verification' });
  }
};

export const resendRegistrationCode = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const pending = await PendingRegistration.findOne({ email: normalizedEmail });

    if (!pending) {
      return res.status(404).json({ message: 'No pending registration for this email. Please register again.' });
    }

    const code = generateCode();
    pending.codeHash = await bcrypt.hash(code, 10);
    pending.attempts = 0;
    pending.expiresAt = new Date(Date.now() + PENDING_TTL_MS);
    await pending.save();

    const sent = await sendVerificationEmail(normalizedEmail, code);
    if (!sent) {
      return res.status(502).json({ message: 'Could not send verification email. Please try again later.' });
    }

    return res.status(200).json({ message: 'Verification code resent', email: normalizedEmail });
  } catch (error) {
    console.error('[CustomerAuth] resendRegistrationCode error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const requestEmailCode = async (req, res) => {
  try {
    const { email } = req.body;
    const user = req.customer;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'A valid email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (isInternalEmail(normalizedEmail)) {
      return res.status(400).json({ message: 'Invalid email address' });
    }

    if (!isInternalEmail(user.email) && normalizedEmail === user.email && user.verifemail !== false) {
      return res.status(400).json({ message: 'This email is already verified on your account' });
    }

    const taken = await CustomerUser.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
    if (taken) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    const code = generateCode();
    user.pendingEmail = normalizedEmail;
    user.emailCodeHash = await bcrypt.hash(code, 10);
    user.emailCodeExpires = new Date(Date.now() + PENDING_TTL_MS);
    user.emailCodeAttempts = 0;
    await user.save();

    const sent = await sendVerificationEmail(normalizedEmail, code);
    if (!sent) {
      return res.status(502).json({ message: 'Could not send verification email. Please try again later.' });
    }

    return res.status(200).json({ message: 'Verification code sent', email: normalizedEmail });
  } catch (error) {
    console.error('[CustomerAuth] requestEmailCode error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const confirmEmailCode = async (req, res) => {
  try {
    const { code } = req.body;
    const user = req.customer;

    if (!code) {
      return res.status(400).json({ message: 'Code is required' });
    }

    if (!user.pendingEmail || !user.emailCodeHash || !user.emailCodeExpires) {
      return res.status(400).json({ message: 'No pending email change. Please request a code first.' });
    }

    if (user.emailCodeExpires < new Date()) {
      user.pendingEmail = null;
      user.emailCodeHash = null;
      user.emailCodeExpires = null;
      user.emailCodeAttempts = 0;
      await user.save();
      return res.status(400).json({ message: 'Code expired. Please request a new one.' });
    }

    if (user.emailCodeAttempts >= MAX_VERIFY_ATTEMPTS) {
      user.pendingEmail = null;
      user.emailCodeHash = null;
      user.emailCodeExpires = null;
      user.emailCodeAttempts = 0;
      await user.save();
      return res.status(429).json({ message: 'Too many attempts. Please request a new code.' });
    }

    const isMatch = await bcrypt.compare(String(code).trim(), user.emailCodeHash);
    if (!isMatch) {
      user.emailCodeAttempts += 1;
      await user.save();
      return res.status(401).json({ message: 'Invalid verification code' });
    }

    const taken = await CustomerUser.findOne({ email: user.pendingEmail, _id: { $ne: user._id } });
    if (taken) {
      user.pendingEmail = null;
      user.emailCodeHash = null;
      user.emailCodeExpires = null;
      user.emailCodeAttempts = 0;
      await user.save();
      return res.status(409).json({ message: 'Email already in use' });
    }

    user.email = user.pendingEmail;
    user.verifemail = true;
    user.pendingEmail = null;
    user.emailCodeHash = null;
    user.emailCodeExpires = null;
    user.emailCodeAttempts = 0;
    await user.save();

    return res.status(200).json({ message: 'Email verified', user: safeUser(user) });
  } catch (error) {
    console.error('[CustomerAuth] confirmEmailCode error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const forgotPassword = async (req, res) => {
  const genericResponse = () =>
    res.status(200).json({ message: 'If an account with that email exists, a reset code has been sent.' });

  try {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) {
      return genericResponse();
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (isInternalEmail(normalizedEmail)) {
      return genericResponse();
    }

    const user = await CustomerUser.findOne({ email: normalizedEmail });
    if (!user || !user.status) {
      return genericResponse();
    }

    const code = generateCode();
    user.resetCodeHash = await bcrypt.hash(code, 10);
    user.resetCodeExpires = new Date(Date.now() + PENDING_TTL_MS);
    user.resetCodeAttempts = 0;
    await user.save();

    await sendPasswordResetEmail(normalizedEmail, code);

    return genericResponse();
  } catch (error) {
    console.error('[CustomerAuth] forgotPassword error:', error);
    return genericResponse();
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: 'Email, code and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await CustomerUser.findOne({ email: normalizedEmail });

    if (!user || !user.resetCodeHash || !user.resetCodeExpires) {
      return res.status(400).json({ message: 'Invalid or expired reset code' });
    }

    if (user.resetCodeExpires < new Date()) {
      user.resetCodeHash = null;
      user.resetCodeExpires = null;
      user.resetCodeAttempts = 0;
      await user.save();
      return res.status(400).json({ message: 'Reset code expired. Please request a new one.' });
    }

    if (user.resetCodeAttempts >= MAX_VERIFY_ATTEMPTS) {
      user.resetCodeHash = null;
      user.resetCodeExpires = null;
      user.resetCodeAttempts = 0;
      await user.save();
      return res.status(429).json({ message: 'Too many attempts. Please request a new code.' });
    }

    const isMatch = await bcrypt.compare(String(code).trim(), user.resetCodeHash);
    if (!isMatch) {
      user.resetCodeAttempts += 1;
      await user.save();
      return res.status(401).json({ message: 'Invalid reset code' });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.resetCodeHash = null;
    user.resetCodeExpires = null;
    user.resetCodeAttempts = 0;
    await user.save();

    await CustomerSession.deleteMany({ userId: user._id });

    return res.status(200).json({ message: 'Password has been reset. You can now sign in.' });
  } catch (error) {
    console.error('[CustomerAuth] resetPassword error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const login = async (req, res) => {
  try {
    const { login: loginInput, password } = req.body;

    if (!loginInput || !password) {
      return res.status(400).json({ message: 'Login and password are required' });
    }

    const isEmail = loginInput.includes('@');
    const user = await CustomerUser.findOne(
      isEmail
        ? { email: loginInput.trim().toLowerCase() }
        : { username: loginInput.trim() }
    );

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.status) {
      return res.status(403).json({ message: 'Account is disabled' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (user.verifemail === false && !user.telegramId) {
      return res.status(403).json({ message: 'Please verify your email before signing in' });
    }

    if (user.twoFAEnabled) {
      const tempToken = jwt.sign(
        { id: user._id, type: 'customer_2fa_pending' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.status(200).json({ requiresTwoFA: true, tempToken });
    }

    const token = generateToken(user._id);
    const expire = new Date(Date.now() + COOKIE_MAX_AGE);

    await CustomerSession.create({
      userId: user._id,
      token,
      expire,
      ip: req.ip,
      device: req.headers['user-agent']
    });

    setAuthCookie(res, token);

    return res.status(200).json({
      message: 'Logged in successfully',
      user: safeUser(user)
    });
  } catch (error) {
    console.error('[CustomerAuth] login error:', error);
    return res.status(500).json({ message: 'Server error during login' });
  }
};

export const verifyLogin2FA = async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) {
      return res.status(400).json({ message: 'Token and code are required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }

    if (decoded.type !== 'customer_2fa_pending') {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const user = await CustomerUser.findById(decoded.id);
    if (!user || !user.twoFAEnabled || !user.twoFASecret) {
      return res.status(401).json({ message: 'Invalid session' });
    }

    if (!user.status) {
      return res.status(403).json({ message: 'Account is disabled' });
    }

    const valid = speakeasy.totp.verify({
      secret: user.twoFASecret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!valid) {
      return res.status(401).json({ message: 'Invalid authentication code' });
    }

    const token = generateToken(user._id);
    const expire = new Date(Date.now() + COOKIE_MAX_AGE);

    await CustomerSession.create({
      userId: user._id,
      token,
      expire,
      ip: req.ip,
      device: req.headers['user-agent']
    });

    setAuthCookie(res, token);

    return res.status(200).json({
      message: 'Logged in successfully',
      user: safeUser(user)
    });
  } catch (error) {
    console.error('[CustomerAuth] verifyLogin2FA error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const logout = async (req, res) => {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (token) {
      await CustomerSession.findOneAndDelete({ token });
    }
    res.clearCookie(COOKIE_NAME);
    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('[CustomerAuth] logout error:', error);
    return res.status(500).json({ message: 'Server error during logout' });
  }
};

export const getMe = async (req, res) => {
  return res.status(200).json({ user: safeUser(req.customer) });
};

export const setup2FA = async (req, res) => {
  try {
    const user = req.customer;
    if (user.twoFAEnabled) {
      return res.status(400).json({ message: '2FA is already enabled' });
    }
    const secret = speakeasy.generateSecret({ name: `BananaTraff (${user.username})`, length: 20 });
    user.twoFASecret = secret.base32;
    await user.save();
    const otpauth = secret.otpauth_url;
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    return res.status(200).json({ secret: secret.base32, qr: qrDataUrl });
  } catch (error) {
    console.error('[2FA] setup error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const enable2FA = async (req, res) => {
  try {
    const { token } = req.body;
    const user = req.customer;
    if (!user.twoFASecret) {
      return res.status(400).json({ message: 'Run setup first' });
    }
    const valid = speakeasy.totp.verify({ secret: user.twoFASecret, encoding: 'base32', token, window: 1 });
    if (!valid) {
      return res.status(400).json({ message: 'Invalid code' });
    }
    user.twoFAEnabled = true;
    await user.save();
    return res.status(200).json({ message: '2FA enabled', user: safeUser(user) });
  } catch (error) {
    console.error('[2FA] enable error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const disable2FA = async (req, res) => {
  try {
    const { token } = req.body;
    const user = req.customer;
    if (!user.twoFAEnabled) {
      return res.status(400).json({ message: '2FA is not enabled' });
    }
    const valid = speakeasy.totp.verify({ secret: user.twoFASecret, encoding: 'base32', token, window: 1 });
    if (!valid) {
      return res.status(400).json({ message: 'Invalid code' });
    }
    user.twoFAEnabled = false;
    user.twoFASecret = null;
    await user.save();
    return res.status(200).json({ message: '2FA disabled', user: safeUser(user) });
  } catch (error) {
    console.error('[2FA] disable error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { username, telegramUsername, currentPassword, newPassword, language } = req.body;
    const user = req.customer;

    if (username !== undefined) {
      if (username.length < 3 || username.length > 30) {
        return res.status(400).json({ message: 'Username must be 3–30 characters' });
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ message: 'Username may only contain letters, numbers and underscores' });
      }
      if (username !== user.username) {
        const taken = await CustomerUser.findOne({ username: username.trim() });
        if (taken) return res.status(409).json({ message: 'Username already taken' });
        user.username = username.trim();
      }
    }

    if (telegramUsername !== undefined) {
      user.telegramUsername = telegramUsername?.trim() || null;
    }

    if (language !== undefined && ['ru', 'en'].includes(language)) {
      user.language = language;
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ message: 'Current password is required to set a new password' });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters' });
      }
      user.password = await bcrypt.hash(newPassword, 12);
    }

    await user.save();

    return res.status(200).json({ message: 'Profile updated', user: safeUser(user) });
  } catch (error) {
    console.error('[CustomerAuth] updateProfile error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Finds the CustomerUser for a given Telegram id, creating one on first
 * contact (same rules for the Login Widget callback and the Mini App auto-login).
 * `tgUser` uses Telegram's own field names: id, username, first_name, photo_url.
 */
export const findOrCreateTelegramCustomer = async ({ tgUser, referralCode }) => {
  const telegramId = String(tgUser.id);

  let user = await CustomerUser.findOne({ telegramId });
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    let baseUsername = (tgUser.username || tgUser.first_name || 'user')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 25);
    if (baseUsername.length < 3) baseUsername = 'tg_' + baseUsername;

    let username = baseUsername;
    let attempt = 0;
    while (await CustomerUser.findOne({ username })) {
      attempt++;
      username = `${baseUsername}${attempt}`;
    }

    const fakeEmail = `tg${telegramId}@banana.internal`;
    const randomPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);

    let referredByUser = null;
    if (referralCode) {
      referredByUser = await CustomerUser.findOne({ referralCode: String(referralCode).toUpperCase() });
    }

    user = await CustomerUser.create({
      username,
      email: fakeEmail,
      password: randomPassword,
      telegramId,
      telegramUsername: tgUser.username || null,
      telegramPhotoUrl: tgUser.photo_url || null,
      referredBy: referredByUser?._id || null,
      verifemail: true
    });
  } else if ((tgUser.photo_url || '') !== (user.telegramPhotoUrl || '')) {
    // Аватарка в TG могла поменяться — обновляем на каждом входе
    user.telegramPhotoUrl = tgUser.photo_url || null;
    if (tgUser.username) user.telegramUsername = tgUser.username;
    await user.save();
  }

  return { user, isNewUser };
};

const issueCustomerSession = async (res, user, req) => {
  const token = generateToken(user._id);
  const expire = new Date(Date.now() + COOKIE_MAX_AGE);

  await CustomerSession.create({
    userId: user._id,
    token,
    expire,
    ip: req.ip,
    device: req.headers['user-agent']
  });

  setAuthCookie(res, token);
};

export const telegramCallback = async (req, res) => {
  try {
    const tgData = req.body;

    if (!tgData || !tgData.hash || !tgData.id) {
      return res.status(400).json({ message: 'Invalid Telegram data' });
    }

    if (!verifyTelegramData(tgData)) {
      return res.status(401).json({ message: 'Telegram auth verification failed' });
    }

    const { user, isNewUser } = await findOrCreateTelegramCustomer({
      tgUser: tgData,
      referralCode: tgData.referralCode || req.body.referralCode
    });

    if (!user.status) {
      return res.status(403).json({ message: 'Account is disabled' });
    }

    await issueCustomerSession(res, user, req);

    if (isNewUser) {
      attachAcquisition({ user, code: req.body?.trackingCode, req }).catch(() => {});
    }

    return res.status(200).json({
      message: 'Logged in via Telegram',
      user: safeUser(user)
    });
  } catch (error) {
    console.error('[CustomerAuth] telegramCallback error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Verifies the `initData` string a Telegram Mini App sends on launch.
 * Uses the Mini App HMAC scheme (different from the Login Widget one above):
 * secret_key = HMAC_SHA256(bot_token, key="WebAppData"), then
 * hash = HMAC_SHA256(data_check_string, key=secret_key).
 * Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
const verifyTelegramWebAppData = (initData) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckArr = [];
  for (const key of Array.from(params.keys()).sort()) {
    dataCheckArr.push(`${key}=${params.get(key)}`);
  }
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > 86400) return null;

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    user = null;
  }
  if (!user || !user.id) return null;

  return { user, startParam: params.get('start_param') || '' };
};

/**
 * Auto-login for the Telegram Mini App: the frontend sends `window.Telegram.WebApp.initData`
 * on launch, we verify it server-side and log the user in exactly like the Login Widget flow.
 */
export const telegramWebAppLogin = async (req, res) => {
  try {
    const { initData } = req.body || {};
    const verified = verifyTelegramWebAppData(initData);
    if (!verified) {
      return res.status(401).json({ message: 'Telegram WebApp verification failed' });
    }

    const { user, isNewUser } = await findOrCreateTelegramCustomer({
      tgUser: verified.user,
      referralCode: verified.startParam
    });

    if (!user.status) {
      return res.status(403).json({ message: 'Account is disabled' });
    }

    await issueCustomerSession(res, user, req);

    if (isNewUser) {
      attachAcquisition({ user, code: req.body?.trackingCode, req }).catch(() => {});
    }

    return res.status(200).json({
      message: 'Logged in via Telegram Mini App',
      user: safeUser(user)
    });
  } catch (error) {
    console.error('[CustomerAuth] telegramWebAppLogin error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

const MAGIC_LINK_TTL_MS = 10 * 60 * 1000;

/**
 * Called by the bot service (internal, shared-secret auth — see
 * middlewares/botInternalMiddleware.js) whenever a user presses "Авторизация"
 * or sends any message: mints a fresh one-time login link for the website.
 */
export const createTelegramMagicLink = async (req, res) => {
  try {
    const tgUser = req.body?.user;
    if (!tgUser || !tgUser.id) {
      return res.status(400).json({ message: 'user is required' });
    }

    const { user } = await findOrCreateTelegramCustomer({
      tgUser,
      referralCode: req.body?.referralCode
    });

    if (!user.status) {
      return res.status(403).json({ message: 'Account is disabled' });
    }

    // Invalidate any older unused links for this user so only the latest one works.
    await TelegramLoginToken.updateMany(
      { customerId: user._id, used: false },
      { $set: { used: true } }
    );

    const loginToken = await TelegramLoginToken.create({
      customerId: user._id,
      telegramId: String(tgUser.id),
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS)
    });

    const siteUrl = (process.env.SITE_URL || 'https://banana-traff-shop.com').replace(/\/$/, '');
    return res.status(200).json({
      url: `${siteUrl}/tg-login?token=${loginToken.token}`,
      expiresInSec: MAGIC_LINK_TTL_MS / 1000
    });
  } catch (error) {
    console.error('[CustomerAuth] createTelegramMagicLink error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Consumes a one-time magic link token (opened from the bot) and logs the
 * matching customer in on the website — no Telegram Login Widget needed.
 */
export const telegramMagicLogin = async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ message: 'token is required' });
    }

    const loginToken = await TelegramLoginToken.findOneAndUpdate(
      { token, used: false, expiresAt: { $gt: new Date() } },
      { $set: { used: true } }
    );
    if (!loginToken) {
      return res.status(401).json({ message: 'Ссылка недействительна или уже использована' });
    }

    const user = await CustomerUser.findById(loginToken.customerId);
    if (!user || !user.status) {
      return res.status(403).json({ message: 'Account not found or disabled' });
    }

    await issueCustomerSession(res, user, req);

    return res.status(200).json({
      message: 'Logged in via Telegram magic link',
      user: safeUser(user)
    });
  } catch (error) {
    console.error('[CustomerAuth] telegramMagicLogin error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const linkTelegram = async (req, res) => {
  try {
    const tgData = req.body;

    if (!tgData || !tgData.hash || !tgData.id) {
      return res.status(400).json({ message: 'Invalid Telegram data' });
    }

    if (!verifyTelegramData(tgData)) {
      return res.status(401).json({ message: 'Telegram auth verification failed' });
    }

    const telegramId = String(tgData.id);

    const existing = await CustomerUser.findOne({ telegramId });
    if (existing && String(existing._id) !== String(req.customer._id)) {
      return res.status(409).json({ message: 'This Telegram account is already linked to another user' });
    }

    const user = req.customer;
    user.telegramId = telegramId;
    if (tgData.username) user.telegramUsername = tgData.username;
    user.telegramPhotoUrl = tgData.photo_url || null;
    await user.save();

    return res.status(200).json({ message: 'Telegram linked successfully', user: safeUser(user) });
  } catch (error) {
    console.error('[CustomerAuth] linkTelegram error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const unlinkTelegram = async (req, res) => {
  try {
    const user = req.customer;
    if (!user.telegramId) {
      return res.status(400).json({ message: 'Telegram is not linked' });
    }
    const updated = await CustomerUser.findByIdAndUpdate(
      user._id,
      { $unset: { telegramId: 1, telegramUsername: 1, telegramPhotoUrl: 1 } },
      { returnDocument: 'after' }
    );
    return res.status(200).json({ message: 'Telegram unlinked', user: safeUser(updated) });
  } catch (error) {
    console.error('[CustomerAuth] unlinkTelegram error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
