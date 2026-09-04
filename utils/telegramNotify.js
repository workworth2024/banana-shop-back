/**
 * Fire-and-forget notification to the banana-shop-bot service, so a customer
 * who's linked their Telegram account gets a live push (e.g. "balance topped
 * up") right in the chat, not just a socket event for the open website tab.
 */
export async function notifyTelegram(telegramId, text, { photoUrl } = {}) {
  try {
    if (!telegramId) return;
    const botServiceUrl = process.env.BOT_SERVICE_URL;
    const key = process.env.BOT_INTERNAL_KEY;
    if (!botServiceUrl || !key) return;

    const res = await fetch(`${botServiceUrl}/internal/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bot-Internal-Key': key
      },
      body: JSON.stringify({ telegramId: String(telegramId), text, photoUrl: photoUrl || undefined })
    });
    return res.ok;
  } catch (e) {
    console.error('[TelegramNotify] error:', e.message);
    return false;
  }
}
