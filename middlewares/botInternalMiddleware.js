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
