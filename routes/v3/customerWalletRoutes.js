import express from 'express';
import Transaction from '../../models/Transaction.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';

const router = express.Router();

router.get('/transactions', verifyCustomer, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = { userId: req.customer._id };
    if (type) query.type = type;
    if (search) query.note = { $regex: search, $options: 'i' };

    const [transactions, total] = await Promise.all([
      Transaction.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Transaction.countDocuments(query)
    ]);

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
