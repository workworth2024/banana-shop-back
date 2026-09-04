import Segment from '../models/Segment.js';
import CustomerUser from '../models/CustomerUser.js';
import { escapeRegex } from '../utils/safeQuery.js';
import { SEGMENT_FIELDS, sanitizeConditions, buildSegmentPipeline } from '../utils/segmentEngine.js';

export const getSegmentFields = async (_req, res) => {
  const fields = Object.entries(SEGMENT_FIELDS).map(([key, def]) => ({
    key,
    type: def.type,
    label: def.label,
    options: def.options || undefined
  }));
  return res.json({ fields });
};

export const previewSegmentCount = async (req, res) => {
  try {
    const conditions = sanitizeConditions(req.body?.conditions);
    const pipeline = buildSegmentPipeline(conditions);
    const result = await CustomerUser.aggregate([...pipeline, { $count: 'count' }]);
    return res.json({ count: result[0]?.count || 0 });
  } catch (error) {
    console.error('[Segment] previewSegmentCount:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const listSegments = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const pg = Math.min(10000, Math.max(1, parseInt(page) || 1));
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 20));

    const query = {};
    if (search) {
      query.name = { $regex: escapeRegex(String(search).slice(0, 100)), $options: 'i' };
    }

    const [items, total] = await Promise.all([
      Segment.find(query)
        .populate('createdBy', 'username name')
        .sort({ createdAt: -1 })
        .skip((pg - 1) * lim)
        .limit(lim)
        .lean(),
      Segment.countDocuments(query)
    ]);

    return res.json({ items, total, pages: Math.ceil(total / lim), currentPage: pg });
  } catch (error) {
    console.error('[Segment] listSegments:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getSegment = async (req, res) => {
  try {
    const segment = await Segment.findById(req.params.id).populate('createdBy', 'username name');
    if (!segment) return res.status(404).json({ message: 'Сегмент не найден' });
    return res.json(segment);
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const createSegment = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Укажите название сегмента' });

    const conditions = sanitizeConditions(req.body?.conditions);
    const pipeline = buildSegmentPipeline(conditions);
    const countResult = await CustomerUser.aggregate([...pipeline, { $count: 'count' }]);

    const segment = await Segment.create({
      name,
      conditions,
      memberCount: countResult[0]?.count || 0,
      computedAt: new Date(),
      createdBy: req.user?._id || null
    });

    return res.status(201).json(segment);
  } catch (error) {
    console.error('[Segment] createSegment:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateSegment = async (req, res) => {
  try {
    const segment = await Segment.findById(req.params.id);
    if (!segment) return res.status(404).json({ message: 'Сегмент не найден' });

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ message: 'Укажите название сегмента' });
      segment.name = name;
    }

    if (req.body?.conditions !== undefined) {
      segment.conditions = sanitizeConditions(req.body.conditions);
      const pipeline = buildSegmentPipeline(segment.conditions);
      const countResult = await CustomerUser.aggregate([...pipeline, { $count: 'count' }]);
      segment.memberCount = countResult[0]?.count || 0;
      segment.computedAt = new Date();
    }

    await segment.save();
    return res.json(segment);
  } catch (error) {
    console.error('[Segment] updateSegment:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Recomputes memberCount without changing conditions — lets the history table
// refresh a stale count (people keep registering/ordering after a segment
// was saved) without re-opening the builder.
export const recomputeSegment = async (req, res) => {
  try {
    const segment = await Segment.findById(req.params.id);
    if (!segment) return res.status(404).json({ message: 'Сегмент не найден' });

    const pipeline = buildSegmentPipeline(segment.conditions);
    const countResult = await CustomerUser.aggregate([...pipeline, { $count: 'count' }]);
    segment.memberCount = countResult[0]?.count || 0;
    segment.computedAt = new Date();
    await segment.save();

    return res.json(segment);
  } catch (error) {
    console.error('[Segment] recomputeSegment:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const deleteSegment = async (req, res) => {
  try {
    const segment = await Segment.findById(req.params.id);
    if (!segment) return res.status(404).json({ message: 'Сегмент не найден' });
    await segment.deleteOne();
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getSegmentMembers = async (req, res) => {
  try {
    const segment = await Segment.findById(req.params.id);
    if (!segment) return res.status(404).json({ message: 'Сегмент не найден' });

    const { page = 1, limit = 20 } = req.query;
    const pg = Math.min(10000, Math.max(1, parseInt(page) || 1));
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 20));

    const pipeline = buildSegmentPipeline(segment.conditions);
    const [items, countResult] = await Promise.all([
      CustomerUser.aggregate([
        ...pipeline,
        { $sort: { createdAt: -1 } },
        { $skip: (pg - 1) * lim },
        { $limit: lim },
        {
          $project: {
            username: 1, uid: 1, email: 1, telegramUsername: 1, balance: 1,
            createdAt: 1, lastSeen: 1, ordersCount: 1, depositsSum: 1
          }
        }
      ]),
      CustomerUser.aggregate([...pipeline, { $count: 'count' }])
    ]);

    const total = countResult[0]?.count || 0;
    return res.json({ items, total, pages: Math.ceil(total / lim), currentPage: pg });
  } catch (error) {
    console.error('[Segment] getSegmentMembers:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
