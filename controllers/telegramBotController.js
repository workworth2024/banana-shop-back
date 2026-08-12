import CustomerUser from '../models/CustomerUser.js';
import Transaction from '../models/Transaction.js';
import { findOrCreateTelegramCustomer } from './customerAuthController.js';

const ALLOWED_LANGUAGES = ['ru', 'en'];

const profileSummary = (user) => ({
  uid: user.uid,
  username: user.username,
  telegramId: user.telegramId,
  telegramUsername: user.telegramUsername,
  balance: user.balance,
  bonusBalance: user.bonusBalance || 0,
  referralCode: user.referralCode,
  language: user.language || 'ru'
});

/**
 * Ensures a CustomerUser exists for this Telegram user (same find-or-create
 * rules as the Login Widget / magic-link flows) and returns a cabinet summary.
 * Called by the bot on /start and whenever it opens "Профиль".
 */
export const ensureBotCustomer = async (req, res) => {
  try {
    const tgUser = req.body?.user;
    if (!tgUser || !tgUser.id) {
      return res.status(400).json({ message: 'user is required' });
    }

    const { user } = await findOrCreateTelegramCustomer({
      tgUser,
      referralCode: req.body?.referralCode
    });

    if (!user.status) {
      return res.status(403).json({ message: 'Account is disabled' });
    }

    return res.status(200).json({ profile: profileSummary(user) });
  } catch (error) {
    console.error('[TelegramBot] ensureBotCustomer error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/** Lightweight profile refresh — requires the customer to already exist (see resolveBotCustomer). */
export const getBotProfile = async (req, res) => {
  return res.status(200).json({ profile: profileSummary(req.customer) });
};

export const getBotLanguage = async (req, res) => {
  try {
    const telegramId = String(req.query.telegramId || '');
    const user = telegramId ? await CustomerUser.findOne({ telegramId }).select('language') : null;
    return res.status(200).json({ language: user?.language || 'ru' });
  } catch (error) {
    console.error('[TelegramBot] getBotLanguage error:', error);
    return res.status(200).json({ language: 'ru' });
  }
};

export const setBotLanguage = async (req, res) => {
  try {
    const language = String(req.body?.language || '');
    if (!ALLOWED_LANGUAGES.includes(language)) {
      return res.status(400).json({ message: 'Invalid language' });
    }
    // req.customer is set by resolveBotCustomer from telegramId in the body/query.
    req.customer.language = language;
    await req.customer.save();
    return res.status(200).json({ profile: profileSummary(req.customer) });
  } catch (error) {
    console.error('[TelegramBot] setBotLanguage error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getBotWallet = async (req, res) => {
  try {
    const limit = Math.min(10, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const transactions = await Transaction.find({ userId: req.customer._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      balance: req.customer.balance,
      bonusBalance: req.customer.bonusBalance || 0,
      transactions
    });
  } catch (error) {
    console.error('[TelegramBot] getBotWallet error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
