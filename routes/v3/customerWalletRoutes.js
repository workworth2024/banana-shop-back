import express from 'express';
import Transaction from '../../models/Transaction.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';

const router = express.Router();

router.get('/transactions', verifyCustomer, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const transactions = await Transaction.find({ userId: req.customer._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Transaction.countDocuments({ userId: req.customer._id });

    return res.status(200).json({
      transactions,
      total,
      pages: Math.ceil(total / Number(limit)),
      currentPage: Number(page)
    });
  } catch (error) {
    console.error('[Wallet] transactions error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
