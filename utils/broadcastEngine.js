import CustomerUser from '../models/CustomerUser.js';
import Segment from '../models/Segment.js';
import Notification from '../models/Notification.js';
import Broadcast from '../models/Broadcast.js';
import { buildSegmentPipeline } from './segmentEngine.js';
import { notifyTelegram } from './telegramNotify.js';
import { io } from '../server.js';

// Broadcast text is free-form admin input, not the fixed, controlled strings
// the rest of the app sends to Telegram — escape it before the bot service
// sends it with parse_mode: 'HTML', so a stray "<" or "&" can't break
// Telegram's parser (or worse, be interpreted as markup).
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function resolveRecipients(broadcast) {
  if (broadcast.audienceType === 'customers') {
    return CustomerUser.find({ _id: { $in: broadcast.customerIds || [] } })
      .select('_id telegramId')
      .lean();
  }

  const segment = await Segment.findById(broadcast.segmentId).lean();
  if (!segment) return [];
  const pipeline = buildSegmentPipeline(segment.conditions);
  return CustomerUser.aggregate([...pipeline, { $project: { _id: 1, telegramId: 1 } }]);
}

export async function previewAudienceCount({ audienceType, customerIds, segmentId }) {
  if (audienceType === 'customers') {
    return CustomerUser.countDocuments({ _id: { $in: customerIds || [] } });
  }
  const segment = await Segment.findById(segmentId).lean();
  if (!segment) return 0;
  const pipeline = buildSegmentPipeline(segment.conditions);
  const result = await CustomerUser.aggregate([...pipeline, { $count: 'count' }]);
  return result[0]?.count || 0;
}

export async function sendBroadcastNow(broadcastId) {
  const broadcast = await Broadcast.findById(broadcastId);
  if (!broadcast || broadcast.status === 'sent' || broadcast.status === 'sending') return broadcast;

  broadcast.status = 'sending';
  await broadcast.save();

  let siteSentCount = 0;
  let botSentCount = 0;
  let failedCount = 0;

  try {
    const recipients = await resolveRecipients(broadcast);
    broadcast.recipientCount = recipients.length;

    for (const recipient of recipients) {
      try {
        if (broadcast.deliverToSite) {
          const notif = await Notification.create({
            userId: recipient._id,
            type: 'broadcast',
            title: broadcast.name,
            message: broadcast.text,
            imageUrl: broadcast.imageUrl || null,
            broadcastId: broadcast._id
          });
          io.of('/customer').to(`customer:${recipient._id}`).emit('notification', {
            id: notif._id,
            type: notif.type,
            title: notif.title,
            message: notif.message,
            imageUrl: notif.imageUrl,
            link: notif.link,
            createdAt: notif.createdAt
          });
          siteSentCount++;
        }

        if (broadcast.deliverToBot && recipient.telegramId) {
          const caption = broadcast.imageUrl
            ? escapeHtml(broadcast.text)
            : `📢 <b>${escapeHtml(broadcast.name)}</b>\n\n${escapeHtml(broadcast.text)}`;
          const ok = await notifyTelegram(recipient.telegramId, caption, { photoUrl: broadcast.imageUrl });
          if (ok) botSentCount++;
          else failedCount++;
        }
      } catch (err) {
        failedCount++;
        console.error('[Broadcast] recipient send error:', recipient._id, err.message);
      }
    }

    broadcast.status = 'sent';
    broadcast.sentAt = new Date();
  } catch (err) {
    broadcast.status = 'failed';
    broadcast.error = err.message;
    console.error('[Broadcast] send error:', broadcastId, err);
  } finally {
    broadcast.siteSentCount = siteSentCount;
    broadcast.botSentCount = botSentCount;
    broadcast.failedCount = failedCount;
    await broadcast.save();
  }

  return broadcast;
}

// Polls for due scheduled broadcasts. No job-queue infra in this app, and
// send volume is small (a few dozen/hundred customers) — a periodic check is
// simpler and good enough. Started once from server.js after Mongo connects.
let schedulerStarted = false;
export function startBroadcastScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const POLL_MS = 20 * 1000;
  setInterval(async () => {
    try {
      const due = await Broadcast.find({ status: 'scheduled', scheduledAt: { $lte: new Date() } }).select('_id');
      for (const { _id } of due) {
        await sendBroadcastNow(_id);
      }
    } catch (err) {
      console.error('[BroadcastScheduler] poll error:', err.message);
    }
  }, POLL_MS);
}
