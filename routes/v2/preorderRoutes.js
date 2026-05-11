import express from 'express';
import jwt from 'jsonwebtoken';
import CustomerUser from '../../models/CustomerUser.js';
import CustomerSession from '../../models/CustomerSession.js';
import { createPreorder } from '../../controllers/preorderController.js';

const router = express.Router();

const verifyPublicToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1]?.trim();
  const envToken = process.env.API_KEY?.trim();
  if (!token || !envToken || token !== envToken) {
    return res.status(401).json({ message: 'Unauthorized: Invalid token' });
  }
  next();
};

const optionalCustomer = async (req, res, next) => {
  try {
    const cookieToken = req.cookies?.customer_token;
    if (cookieToken) {
      const decoded = jwt.verify(cookieToken, process.env.JWT_SECRET);
      if (decoded.type === 'customer') {
        const session = await CustomerSession.findOne({ token: cookieToken, userId: decoded.id });
        if (session && session.expire >= new Date()) {
          const user = await CustomerUser.findById(decoded.id);
          if (user && user.status) req.customer = user;
        }
      }
    }
  } catch {}
  next();
};

router.post('/', verifyPublicToken, optionalCustomer, createPreorder);

export default router;
