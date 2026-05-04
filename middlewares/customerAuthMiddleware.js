import jwt from 'jsonwebtoken';
import CustomerUser from '../models/CustomerUser.js';
import CustomerSession from '../models/CustomerSession.js';

const COOKIE_NAME = 'customer_token';

export const verifyCustomer = async (req, res, next) => {
  const token = req.cookies[COOKIE_NAME] || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type !== 'customer') {
      return res.status(401).json({ message: 'Invalid token type' });
    }

    const session = await CustomerSession.findOne({ token, userId: decoded.id });
    if (!session || session.expire < new Date()) {
      return res.status(401).json({ message: 'Session expired or invalid' });
    }

    const user = await CustomerUser.findById(decoded.id);
    if (!user || !user.status) {
      return res.status(403).json({ message: 'Account not found or disabled' });
    }

    req.customer = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};
