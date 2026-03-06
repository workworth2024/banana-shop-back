import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Session from '../models/Session.js';

export const verifyToken = async (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    
    // Check session in DB
    const session = await Session.findOne({ token, userId: decoded.id });
    if (!session || session.expire < new Date()) {
      return res.status(401).json({ message: 'Session expired or invalid' });
    }

    const user = await User.findById(decoded.id).populate('role_id');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.status) {
      return res.status(403).json({ message: 'Account not activated' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

export const isAdmin = (req, res, next) => {
  if (req.user.role_id.name !== 'admin' && req.user.role_id.access !== 'all') {
    return res.status(403).json({ message: 'Access denied: Admin only' });
  }
  next();
};

export const hasAccess = (accessLevel) => {
  return (req, res, next) => {
    const userAccess = req.user.role_id.access;
    if (userAccess === 'all' || userAccess === accessLevel) {
      next();
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }
  };
};
