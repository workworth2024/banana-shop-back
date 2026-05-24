import CustomerUser from '../models/CustomerUser.js';
import CustomerSession from '../models/CustomerSession.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';
import Order from '../models/Order.js';
import Preorder from '../models/Preorder.js';
import ServiceOrder from '../models/ServiceOrder.js';
import bcrypt from 'bcryptjs';
import { io, onlineCustomers } from '../server.js';
import { createAdminNotif } from './adminNotifController.js';
import { escapeRegex } from '../utils/safeQuery.js';
import { creditReferralReward } from '../utils/referral.js';

export const getCustomers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', status, sortBy = 'createdAt', order = 'desc' } = req.query;

    const query = {};

    if (search) {
      const safeSearch = escapeRegex(String(search).slice(0, 100));
      query.$or = [
        { username: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } },
        { uid: { $regex: safeSearch, $options: 'i' } },
        { telegramUsername: { $regex: safeSearch, $options: 'i' } }
      ];
    }

    if (status !== undefined && status !== '') {
      query.status = status === 'true';
    }

    const skip = (Number(page) - 1) * Number(limit);
    const sortOptions = { [sortBy]: order === 'desc' ? -1 : 1 };

    const customers = await CustomerUser.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(Number(limit))
      .select('-password -twoFASecret');

    const total = await CustomerUser.countDocuments(query);

    const customersWithOnline = customers.map(c => ({
      ...c.toObject(),
      isOnline: onlineCustomers.has(String(c._id))
    }));

    return res.status(200).json({
      customers: customersWithOnline,
      total,
      pages: Math.ceil(total / Number(limit)),
      currentPage: Number(page)
    });
  } catch (error) {
    console.error('[CustomerController] getCustomers:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getCustomer = async (req, res) => {
  try {
    const customer = await CustomerUser.findById(req.params.id)
      .select('-password -twoFASecret')
      .populate('referredBy', 'username uid telegramUsername referralCode email');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    return res.status(200).json({ customer });
  } catch (error) {
    console.error('[CustomerController] getCustomer:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const setCustomerReferrer = async (req, res) => {
  try {
    const { referralCode, backfill = true } = req.body;
    const customer = await CustomerUser.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    let newReferrer = null;
    if (referralCode) {
      const code = String(referralCode).trim().toUpperCase();
      newReferrer = await CustomerUser.findOne({ referralCode: code });
      if (!newReferrer) return res.status(404).json({ message: 'Referrer with this code not found' });
      if (String(newReferrer._id) === String(customer._id)) {
        return res.status(400).json({ message: 'Cannot set self as referrer' });
      }
    }

    customer.referredBy = newReferrer?._id || null;
    await customer.save();

    let backfilled = 0;
    if (backfill && newReferrer) {
      const deliveredOrders = await Order.find({ customerId: customer._id, status: 'delivered' });
      for (const o of deliveredOrders) {
        try {
          await creditReferralReward({
            customerId: customer._id,
            orderAmount: o.amount,
            orderType: 'order',
            orderId: o._id,
            orderUid: o.uid,
            productType: o.productType
          });
          backfilled++;
        } catch {}
      }
      const paidPreorders = await Preorder.find({ customerId: customer._id, paymentStatus: 'paid' });
      for (const p of paidPreorders) {
        try {
          await creditReferralReward({
            customerId: customer._id,
            orderAmount: p.amountPaid,
            orderType: 'preorder',
            orderId: p._id,
            orderUid: p.uid,
            productType: p.productType === 'youtube' ? 'YoutubeProduct' : 'GoogleAdsProduct'
          });
          backfilled++;
        } catch {}
      }
      const paidServices = await ServiceOrder.find({ customerId: customer._id, paymentStatus: 'paid' });
      for (const s of paidServices) {
        try {
          await creditReferralReward({
            customerId: customer._id,
            orderAmount: s.amountPaid,
            orderType: 'service_order',
            orderId: s._id,
            orderUid: s.uid
          });
          backfilled++;
        } catch {}
      }
    }

    const populated = await CustomerUser.findById(customer._id)
      .select('-password -twoFASecret')
      .populate('referredBy', 'username uid telegramUsername referralCode email');

    return res.status(200).json({
      message: newReferrer ? 'Referrer assigned' : 'Referrer cleared',
      customer: populated,
      backfilled
    });
  } catch (error) {
    console.error('[CustomerController] setCustomerReferrer:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateCustomerStatus = async (req, res) => {
  try {
    const customer = await CustomerUser.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    customer.status = !customer.status;
    await customer.save();

    if (!customer.status) {
      await CustomerSession.deleteMany({ userId: customer._id });
    }

    return res.status(200).json({
      message: `Customer ${customer.status ? 'activated' : 'deactivated'}`,
      status: customer.status
    });
  } catch (error) {
    console.error('[CustomerController] updateCustomerStatus:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const adjustBalance = async (req, res) => {
  try {
    const { amount, note } = req.body;
    const parsed = parseFloat(amount);

    if (isNaN(parsed)) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const customer = await CustomerUser.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const newBalance = parseFloat((customer.balance + parsed).toFixed(2));
    if (newBalance < 0) {
      return res.status(400).json({ message: 'Balance cannot go below zero' });
    }

    customer.balance = newBalance;
    await customer.save();

    const txDoc = await Transaction.create({
      userId: customer._id,
      type: parsed >= 0 ? 'deposit_admin' : 'withdraw_admin',
      status: 'success',
      amount: parsed,
      currency: 'USD',
      note: note || null
    });

    io.of('/customer').to(`customer:${customer._id}`).emit('balance_updated', {
      balance: customer.balance
    });

    try {
      const isDeposit = parsed >= 0;
      const notif = await Notification.create({
        userId: customer._id,
        type: 'balance_updated',
        title: isDeposit
          ? { ru: 'Баланс пополнен', en: 'Balance topped up' }
          : { ru: 'Списание с баланса', en: 'Balance deducted' },
        message: isDeposit
          ? {
              ru: `На ваш баланс зачислено $${Math.abs(parsed).toFixed(2)}${note ? '. ' + note : ''}`,
              en: `$${Math.abs(parsed).toFixed(2)} has been added to your balance${note ? '. ' + note : ''}`
            }
          : {
              ru: `С вашего баланса списано $${Math.abs(parsed).toFixed(2)}${note ? '. ' + note : ''}`,
              en: `$${Math.abs(parsed).toFixed(2)} has been deducted from your balance${note ? '. ' + note : ''}`
            },
        link: '/profile/wallet'
      });
      io.of('/customer').to(`customer:${customer._id}`).emit('notification', {
        id: notif._id, type: notif.type, title: notif.title,
        message: notif.message, link: notif.link, createdAt: notif.createdAt
      });
    } catch {}

    const isDeposit = parsed >= 0;
    createAdminNotif({
      category: 'transaction',
      type: isDeposit ? 'transaction_deposit' : 'transaction_payment',
      title: isDeposit ? 'Пополнение баланса' : 'Списание с баланса',
      message: `${customer.username}: ${isDeposit ? '+' : ''}$${parsed.toFixed(2)}${note ? ' — ' + note : ''}`,
      link: `/transactions?search=${encodeURIComponent(txDoc.uid)}`,
      meta: { customerId: customer._id, amount: parsed, transactionUid: txDoc.uid }
    });

    return res.status(200).json({
      message: 'Balance updated',
      balance: customer.balance
    });
  } catch (error) {
    console.error('[CustomerController] adjustBalance:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const resetCustomerPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    const customer = await CustomerUser.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    customer.password = await bcrypt.hash(newPassword, 12);
    await customer.save();
    await CustomerSession.deleteMany({ userId: customer._id });
    return res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('[CustomerController] resetPassword:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getAdminTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', type = '', startDate, endDate } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = {};

    if (type) query.type = type;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (search) {
      const safe = escapeRegex(String(search).slice(0, 100));
      const matchingCustomers = await CustomerUser.find({
        $or: [
          { username: { $regex: safe, $options: 'i' } },
          { uid: { $regex: safe, $options: 'i' } }
        ]
      }).select('_id').limit(50);
      if (matchingCustomers.length) {
        query.userId = { $in: matchingCustomers.map(c => c._id) };
      } else {
        query.$or = [
          { uid: { $regex: safe, $options: 'i' } },
          { note: { $regex: safe, $options: 'i' } }
        ];
      }
    }

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('userId', 'username uid');

    const total = await Transaction.countDocuments(query);

    return res.status(200).json({
      transactions,
      total,
      pages: Math.ceil(total / Number(limit)),
      currentPage: Number(page)
    });
  } catch (error) {
    console.error('[CustomerController] getAdminTransactions:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
