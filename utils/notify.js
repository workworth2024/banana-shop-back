import Notification from '../models/Notification.js';
import CustomerUser from '../models/CustomerUser.js';
import { io } from '../server.js';
import { notifyTelegram } from './telegramNotify.js';

const STOREFRONT_URL = (process.env.STOREFRONT_URL || 'https://banana-traff-shop.com').replace(/\/+$/, '');

/**
 * Single entry point for "tell the customer something happened" — creates the
 * Notification doc + emits the website socket event (as before), and — if the
 * customer has linked their Telegram — also pushes the same message to the bot.
 * Website and bot are independent: linking a Telegram account never replaces
 * the website notification, it's always both when both exist.
 *
 * `customer` is optional — pass an already-loaded doc/lean object with
 * telegramId/language to skip an extra query; otherwise it's fetched here.
 *
 * `buttonText` is optional (same convention as broadcasts) — when given
 * alongside `link`, it shows as a CTA button both on the website notification
 * and as a Telegram inline button.
 *
 * `telegramButtonUrl` is optional — when the right destination for the
 * Telegram button isn't the same as the website `link` (e.g. a bot deep
 * link that opens the product/order flow inside Telegram itself instead of
 * bouncing out to the site), pass it here and it takes over just for the
 * Telegram push; the website notification still uses `link` either way.
 */
export async function notifyCustomer({ customerId, customer, type, title, message, link, buttonText, telegramButtonUrl }) {
  const notif = await Notification.create({ userId: customerId, type, title, message, link, buttonText: buttonText || null });

  io.of('/customer').to(`customer:${customerId}`).emit('notification', {
    id: notif._id,
    type: notif.type,
    title: notif.title,
    message: notif.message,
    link: notif.link,
    buttonText: notif.buttonText,
    createdAt: notif.createdAt
  });

  try {
    const cust = customer || await CustomerUser.findById(customerId).select('telegramId language').lean();
    if (cust?.telegramId) {
      const lang = cust.language === 'en' ? 'en' : 'ru';
      const text = `🔔 <b>${title[lang] || title.ru}</b>\n\n${message[lang] || message.ru}`;
      const buttonUrl = telegramButtonUrl || (link ? (/^https?:\/\//i.test(link) ? link : `${STOREFRONT_URL}${link}`) : null);
      notifyTelegram(cust.telegramId, text, (buttonText && buttonUrl) ? { buttonText, buttonUrl } : undefined).catch(() => {});
    }
  } catch (e) {
    console.error('[Notify] telegram push lookup failed:', e.message);
  }

  return notif;
}
