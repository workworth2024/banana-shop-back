import CustomerUser from '../models/CustomerUser.js';
import CustomerSession from '../models/CustomerSession.js';
import Transaction from '../models/Transaction.js';
import bcrypt from 'bcryptjs';

export const getCustomers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', status, sortBy = 'createdAt', order = 'desc' } = req.query;

    const query = {};

    if (search) {
      const safeSearch = String(search).slice(0, 200);
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

    return res.status(200).json({
      customers,
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
    const customer = await CustomerUser.findById(req.params.id).select('-password -twoFASecret');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    return res.status(200).json({ customer });
  } catch (error) {
    console.error('[CustomerController] getCustomer:', error);
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

    await Transaction.create({
      userId: customer._id,
      type: parsed >= 0 ? 'deposit_admin' : 'withdraw_admin',
      status: 'success',
      amount: parsed,
      currency: 'USD',
      note: note || null
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
