import express from 'express';
import { getPublicPartners, getPublicPartnerById } from '../../controllers/partnerController.js';

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

router.get('/', verifyPublicToken, getPublicPartners);
router.get('/:id', verifyPublicToken, getPublicPartnerById);

export default router;
