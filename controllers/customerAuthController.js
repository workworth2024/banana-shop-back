import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import CustomerUser from '../models/CustomerUser.js';
import CustomerSession from '../models/CustomerSession.js';
import { createAdminNotif } from './adminNotifController.js';

const COOKIE_NAME = 'customer_token';
const JWT_EXPIRES_IN = '7d';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

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

const safeUser = (user) => ({
  id: user._id,
  uid: user.uid,
  username: user.username,
  email: user.email,
  telegramUsername: user.telegramUsername,
  telegramLinked: !!user.telegramId,
  balance: user.balance,
  referralCode: user.referralCode,
  twoFAEnabled: user.twoFAEnabled,
  language: user.language || 'en'
});

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

export const register = async (req, res) => {
  try {
    const { username, email, password, telegramUsername, referralCode } = req.body;

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

    const existing = await CustomerUser.findOne({
      $or: [{ username: username.trim() }, { email: email.trim().toLowerCase() }]
    });
    if (existing) {
      return res.status(409).json({ message: 'Username or email already in use' });
    }

    let referredByUser = null;
    if (referralCode) {
      referredByUser = await CustomerUser.findOne({ referralCode: referralCode.toUpperCase() });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = await CustomerUser.create({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      telegramUsername: telegramUsername?.trim() || null,
      referredBy: referredByUser?._id || null
    });

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

    return res.status(201).json({
      message: 'Account created successfully',
      user: safeUser(newUser)
    });
  } catch (error) {
    console.error('[CustomerAuth] register error:', error);
    return res.status(500).json({ message: 'Server error during registration' });
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
    const { username, email, telegramUsername, currentPassword, newPassword, language } = req.body;
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

    if (email !== undefined) {
      const normalized = email.trim().toLowerCase();
      if (normalized !== user.email) {
        const taken = await CustomerUser.findOne({ email: normalized });
        if (taken) return res.status(409).json({ message: 'Email already in use' });
        user.email = normalized;
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

export const telegramCallback = async (req, res) => {
  try {
    const tgData = req.body;

    if (!tgData || !tgData.hash || !tgData.id) {
      return res.status(400).json({ message: 'Invalid Telegram data' });
    }

    if (!verifyTelegramData(tgData)) {
      return res.status(401).json({ message: 'Telegram auth verification failed' });
    }

    const telegramId = String(tgData.id);

    let user = await CustomerUser.findOne({ telegramId });

    if (!user) {
      let baseUsername = (tgData.username || tgData.first_name || 'user')
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

      user = await CustomerUser.create({
        username,
        email: fakeEmail,
        password: randomPassword,
        telegramId,
        telegramUsername: tgData.username || null
      });
    }

    if (!user.status) {
      return res.status(403).json({ message: 'Account is disabled' });
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
      message: 'Logged in via Telegram',
      user: safeUser(user)
    });
  } catch (error) {
    console.error('[CustomerAuth] telegramCallback error:', error);
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
    user.telegramId = null;
    await user.save();
    return res.status(200).json({ message: 'Telegram unlinked', user: safeUser(user) });
  } catch (error) {
    console.error('[CustomerAuth] unlinkTelegram error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
