import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Session from '../models/Session.js';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'secret', {
    expiresIn: '24h'
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

    const hashedPassword = await bcrypt.hash(password, 10);
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

    const token = generateToken(user._id);

    // Save session
    const expire = new Date();
    expire.setHours(expire.getHours() + 24);

    await Session.create({
      userId: user._id,
      token,
      expire,
      ip: req.ip,
      device: req.headers['user-agent']
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24h
    });

    return res.status(200).json({
      message: 'Logged in successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role_id.name,
        access: user.role_id.access
      },
      token
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during login' });
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
      access: req.user.role_id.access
    }
  });
};
