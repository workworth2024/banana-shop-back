import CustomerUser from '../models/CustomerUser.js';

/**
 * Verifies requests coming from the banana-shop-bot service (not public) —
 * shared-secret header, same trust model as the v2 public API key.
 */
export const verifyBotInternal = (req, res, next) => {
  const key = req.headers['x-bot-internal-key'];
  const envKey = process.env.BOT_INTERNAL_KEY;
  if (!key || !envKey || key !== envKey) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
};

/**
 * Resolves `req.query.telegramId` to a CustomerUser and sets `req.customer`,
 * the same shape `verifyCustomer` sets from a cookie — lets the bot reuse the
 * exact same "my orders / my wallet / ..." controllers used by the website.
 * Must run after `verifyBotInternal`.
 */
export const resolveBotCustomer = async (req, res, next) => {
  try {
    const telegramId = String(req.query.telegramId || req.body?.telegramId || '');
    if (!telegramId) {
      return res.status(400).json({ message: 'telegramId is required' });
    }
    const user = await CustomerUser.findOne({ telegramId });
    if (!user) {
      return res.status(404).json({ message: 'Customer not linked yet' });
    }
    if (!user.status) {
      return res.status(403).json({ message: 'Account is disabled' });
    }
    req.customer = user;
    next();
  } catch (error) {
    console.error('[BotInternal] resolveBotCustomer error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
