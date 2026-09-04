import mongoose from 'mongoose';
import Broadcast from '../models/Broadcast.js';
import { escapeRegex } from '../utils/safeQuery.js';
import { previewAudienceCount, sendBroadcastNow } from '../utils/broadcastEngine.js';
import { generateFilename, bunnyUpload, getBunnyPublicUrl } from '../utils/bunnyStorage.js';

export const uploadBroadcastImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image uploaded' });
    const filename = generateFilename(req.file.originalname);
    const remotePath = `/broadcasts/${filename}`;
    await bunnyUpload(remotePath, req.file.buffer, req.file.mimetype);
    return res.json({ url: getBunnyPublicUrl(remotePath) });
  } catch (error) {
    console.error('[Broadcast] uploadBroadcastImage:', error);
    return res.status(500).json({ message: 'Error uploading image' });
  }
};

export const previewBroadcastAudience = async (req, res) => {
  try {
    const { audienceType, customerIds, segmentId } = req.body || {};
    if (!['customers', 'segment'].includes(audienceType)) return res.json({ count: 0 });
    if (audienceType === 'segment' && !mongoose.isValidObjectId(segmentId)) return res.json({ count: 0 });
    const validIds = Array.isArray(customerIds) ? customerIds.filter((id) => mongoose.isValidObjectId(id)) : [];
    const count = await previewAudienceCount({ audienceType, customerIds: validIds, segmentId });
    return res.json({ count });
  } catch (error) {
    console.error('[Broadcast] previewBroadcastAudience:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const listBroadcasts = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const pg = Math.min(10000, Math.max(1, parseInt(page) || 1));
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 20));

    const query = {};
    if (search) {
      query.name = { $regex: escapeRegex(String(search).slice(0, 100)), $options: 'i' };
    }

    const [items, total] = await Promise.all([
      Broadcast.find(query)
        .populate('createdBy', 'username name')
        .populate('segmentId', 'name')
        .sort({ createdAt: -1 })
        .skip((pg - 1) * lim)
        .limit(lim)
        .lean(),
      Broadcast.countDocuments(query)
    ]);

    return res.json({ items, total, pages: Math.ceil(total / lim), currentPage: pg });
  } catch (error) {
    console.error('[Broadcast] listBroadcasts:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getBroadcast = async (req, res) => {
  try {
    const broadcast = await Broadcast.findById(req.params.id)
      .populate('createdBy', 'username name')
      .populate('segmentId', 'name')
      .populate('customerIds', 'username uid');
    if (!broadcast) return res.status(404).json({ message: 'Рассылка не найдена' });
    return res.json(broadcast);
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
};

function validateBroadcastInput(body) {
  if (!body.name || !String(body.name).trim()) return 'Укажите название рассылки';
  if (!body.text || !String(body.text).trim()) return 'Укажите текст рассылки';
  if (!['customers', 'segment'].includes(body.audienceType)) return 'Укажите получателей';
  if (body.audienceType === 'customers' && (!Array.isArray(body.customerIds) || !body.customerIds.length)) {
    return 'Выберите хотя бы одного пользователя';
  }
  if (body.audienceType === 'segment' && !mongoose.isValidObjectId(body.segmentId)) {
    return 'Выберите сегмент';
  }
  if (!body.deliverToSite && !body.deliverToBot) return 'Выберите хотя бы один способ доставки';
  if ((body.buttonText && !body.buttonUrl) || (!body.buttonText && body.buttonUrl)) {
    return 'Укажите и название кнопки, и ссылку — или не заполняйте оба поля';
  }
  if (body.buttonUrl) {
    try { new URL(body.buttonUrl); } catch { return 'Некорректная ссылка для кнопки'; }
  }
  if (body.launchType === 'scheduled') {
    if (!body.scheduledAt || Number.isNaN(new Date(body.scheduledAt).getTime())) return 'Укажите дату и время отложенного запуска';
    if (new Date(body.scheduledAt).getTime() <= Date.now()) return 'Дата отложенного запуска должна быть в будущем';
  }
  return null;
}

export const createBroadcast = async (req, res) => {
  try {
    const err = validateBroadcastInput(req.body || {});
    if (err) return res.status(400).json({ message: err });

    const {
      name, text, launchType, scheduledAt, audienceType, customerIds, segmentId,
      deliverToSite, deliverToBot, imageUrl, buttonText, buttonUrl
    } = req.body;

    const validCustomerIds = Array.isArray(customerIds) ? customerIds.filter((id) => mongoose.isValidObjectId(id)) : [];

    const broadcast = await Broadcast.create({
      name: String(name).trim(),
      text: String(text).trim().slice(0, 4000),
      launchType: launchType === 'scheduled' ? 'scheduled' : 'now',
      scheduledAt: launchType === 'scheduled' ? new Date(scheduledAt) : null,
      audienceType,
      customerIds: audienceType === 'customers' ? validCustomerIds : [],
      segmentId: audienceType === 'segment' ? segmentId : null,
      deliverToSite: deliverToSite !== false,
      deliverToBot: deliverToBot !== false,
      imageUrl: imageUrl || null,
      buttonText: buttonText ? String(buttonText).trim().slice(0, 60) : null,
      buttonUrl: buttonUrl ? String(buttonUrl).trim() : null,
      // Always starts as 'scheduled' — sendBroadcastNow() itself flips it to
      // 'sending' then 'sent'/'failed'. Pre-setting 'sending' here would make
      // its own re-entrancy guard (skip if already sending/sent) bail out
      // immediately and never actually send anything.
      status: 'scheduled',
      createdBy: req.user?._id || null
    });

    if (broadcast.launchType === 'now') {
      await sendBroadcastNow(broadcast._id);
    }

    const fresh = await Broadcast.findById(broadcast._id).populate('createdBy', 'username name').populate('segmentId', 'name');
    return res.status(201).json(fresh);
  } catch (error) {
    console.error('[Broadcast] createBroadcast:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const cancelBroadcast = async (req, res) => {
  try {
    const broadcast = await Broadcast.findById(req.params.id);
    if (!broadcast) return res.status(404).json({ message: 'Рассылка не найдена' });
    if (broadcast.status !== 'scheduled') return res.status(400).json({ message: 'Можно отменить только запланированную рассылку' });
    broadcast.status = 'cancelled';
    await broadcast.save();
    return res.json(broadcast);
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const deleteBroadcast = async (req, res) => {
  try {
    const broadcast = await Broadcast.findById(req.params.id);
    if (!broadcast) return res.status(404).json({ message: 'Рассылка не найдена' });
    if (broadcast.status === 'sending') return res.status(400).json({ message: 'Рассылка сейчас отправляется, подождите' });
    await broadcast.deleteOne();
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
};
