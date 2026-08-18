import Notification from '../models/Notification.js';
import CustomerUser from '../models/CustomerUser.js';
import { io } from '../server.js';
import { notifyTelegram } from './telegramNotify.js';

/**
 * Single entry point for "tell the customer something happened" — creates the
 * Notification doc + emits the website socket event (as before), and — if the
 * customer has linked their Telegram — also pushes the same message to the bot.
 * Website and bot are independent: linking a Telegram account never replaces
 * the website notification, it's always both when both exist.
 *
 * `customer` is optional — pass an already-loaded doc/lean object with
 * telegramId/language to skip an extra query; otherwise it's fetched here.
 */
export async function notifyCustomer({ customerId, customer, type, title, message, link }) {
  const notif = await Notification.create({ userId: customerId, type, title, message, link });

  io.of('/customer').to(`customer:${customerId}`).emit('notification', {
    id: notif._id,
    type: notif.type,
    title: notif.title,
    message: notif.message,
    link: notif.link,
    createdAt: notif.createdAt
  });

  try {
    const cust = customer || await CustomerUser.findById(customerId).select('telegramId language').lean();
    if (cust?.telegramId) {
      const lang = cust.language === 'en' ? 'en' : 'ru';
      const text = `🔔 <b>${title[lang] || title.ru}</b>\n\n${message[lang] || message.ru}`;
      notifyTelegram(cust.telegramId, text).catch(() => {});
    }
  } catch (e) {
    console.error('[Notify] telegram push lookup failed:', e.message);
  }

  return notif;
}
