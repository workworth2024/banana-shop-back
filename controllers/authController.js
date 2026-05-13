import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Session from '../models/Session.js';

const generateToken = (id) => {
  return jwt.sign({ id, type: 'admin' }, process.env.JWT_SECRET, {
    expiresIn: '24h'
  });
};

const generateTempToken = (id) => {
  return jwt.sign({ id, type: 'admin_2fa_pending' }, process.env.JWT_SECRET, {
    expiresIn: '5m'
  });
};

const createSession = async (userId, token, req) => {
  const expire = new Date();
  expire.setHours(expire.getHours() + 24);
  await Session.create({
    userId,
    token,
    expire,
    ip: req.ip,
    device: req.headers['user-agent']
  });
};

export const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const userExists = await User.findOne({ $or: [{ username }, { email }] });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const newRole = await Role.findOne({ name: 'new' });

    const newUser = await User.create({
      username,
      email,
      password: hashedPassword,
      role_id: newRole._id,
      status: false
    });

    return res.status(201).json({
      message: 'Account created! Please wait for approval from another main admin.',
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
        role: newRole.name,
        status: newUser.status
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during registration' });
  }
};

export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const user = await User.findOne({ username }).populate('role_id');
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.status) {
      return res.status(403).json({
        message: 'Your account is not activated. Please wait for approval from the admin.'
      });
    }

    if (user.role_id.access === 'nothing') {
      return res.status(403).json({ message: 'Access denied: You have no permissions.' });
    }

    if (user.twoFAEnabled) {
      const tempToken = generateTempToken(user._id);
      return res.status(200).json({ requires2FA: true, tempToken });
    }

    const token = generateToken(user._id);
    await createSession(user._id, token, req);

    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    return res.status(200).json({
      message: 'Logged in successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role_id.name,
        access: user.role_id.access,
        twoFAEnabled: user.twoFAEnabled
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during login' });
  }
};

export const verifyLogin2FA = async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) {
      return res.status(400).json({ message: 'tempToken and code are required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    if (decoded.type !== 'admin_2fa_pending') {
      return res.status(401).json({ message: 'Invalid token type' });
    }

    const user = await User.findById(decoded.id).populate('role_id');
    if (!user || !user.twoFAEnabled || !user.twoFASecret) {
      return res.status(401).json({ message: 'Invalid request' });
    }

    const valid = speakeasy.totp.verify({
      secret: user.twoFASecret,
      encoding: 'base32',
      token: String(code),
      window: 1
    });

    if (!valid) {
      return res.status(401).json({ message: 'Invalid 2FA code' });
    }

    const token = generateToken(user._id);
    await createSession(user._id, token, req);

    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    return res.status(200).json({
      message: 'Logged in successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role_id.name,
        access: user.role_id.access,
        twoFAEnabled: user.twoFAEnabled
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const logout = async (req, res) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    if (token) {
      await Session.findOneAndDelete({ token });
    }
    res.clearCookie('token');
    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Server error during logout' });
  }
};

export const checkAuth = async (req, res) => {
  return res.status(200).json({
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role_id.name,
      access: req.user.role_id.access,
      twoFAEnabled: req.user.twoFAEnabled
    }
  });
};

export const getSessions = async (req, res) => {
  try {
    const currentToken = req.cookies.token || req.headers.authorization?.split(' ')[1];
    const sessions = await Session.find({ userId: req.user._id }).sort({ createdAt: -1 });
    const result = sessions.map(s => ({
      id: s._id,
      ip: s.ip,
      device: s.device,
      createdAt: s.createdAt,
      expire: s.expire,
      isCurrent: s.token === currentToken
    }));
    return res.status(200).json({ sessions: result });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const terminateOtherSessions = async (req, res) => {
  try {
    const currentToken = req.cookies.token || req.headers.authorization?.split(' ')[1];
    await Session.deleteMany({ userId: req.user._id, token: { $ne: currentToken } });
    return res.status(200).json({ message: 'All other sessions terminated' });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const setup2FA = async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({ name: `Banana CRM (${req.user.username})` });
    req.user.twoFASecret = secret.base32;
    await req.user.save();

    const otpauthUrl = secret.otpauth_url;
    const qrDataUrl = await qrcode.toDataURL(otpauthUrl);

    return res.status(200).json({ qrCode: qrDataUrl, secret: secret.base32 });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const enable2FA = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'Token required' });

    const user = await User.findById(req.user._id);
    if (!user.twoFASecret) {
      return res.status(400).json({ message: 'Run setup first' });
    }

    const valid = speakeasy.totp.verify({
      secret: user.twoFASecret,
      encoding: 'base32',
      token: String(token),
      window: 1
    });

    if (!valid) return res.status(401).json({ message: 'Invalid code' });

    user.twoFAEnabled = true;
    await user.save();

    return res.status(200).json({ message: '2FA enabled' });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const disable2FA = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'Token required' });

    const user = await User.findById(req.user._id);
    if (!user.twoFAEnabled) {
      return res.status(400).json({ message: '2FA is not enabled' });
    }

    const valid = speakeasy.totp.verify({
      secret: user.twoFASecret,
      encoding: 'base32',
      token: String(token),
      window: 1
    });

    if (!valid) return res.status(401).json({ message: 'Invalid code' });

    user.twoFAEnabled = false;
    user.twoFASecret = null;
    await user.save();

    return res.status(200).json({ message: '2FA disabled' });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
};
