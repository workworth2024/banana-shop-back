import mongoose from 'mongoose';
import Manual from '../models/Manual.js';
import { bunnyUpload, generateFilename, getBunnyPublicUrl } from '../utils/bunnyStorage.js';
import { deleteAnyFile, extractImageUrls } from '../utils/deleteFile.js';
import { escapeRegex } from '../utils/safeQuery.js';

const MAX_TAGS = 10;

/** Принимает JSON-строку/массив/CSV из FormData, возвращает массив валидных ObjectId (или undefined, если поле не передано) */
const parseTagIds = (raw) => {
  if (raw === undefined) return undefined;
  let list = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try { list = JSON.parse(s); } catch { list = s.split(','); }
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(v => String(v).trim()))]
    .filter(v => mongoose.isValidObjectId(v))
    .slice(0, MAX_TAGS);
};

const deleteManualFile = (urlOrPath) => {
  if (!urlOrPath) return;
  deleteAnyFile(urlOrPath);
};

const uploadManualFile = async (file) => {
  const filename = generateFilename(file.originalname);
  const remotePath = `/manuals/${filename}`;
  await bunnyUpload(remotePath, file.buffer, file.mimetype);
  return getBunnyPublicUrl(remotePath);
};

export const getManuals = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', filter, tag, startDate, endDate } = req.query;
    const safeSearch = escapeRegex(String(search).slice(0, 100));
    const query = {};

    if (safeSearch) {
      query.$or = [
        { 'title.ru': { $regex: safeSearch, $options: 'i' } },
        { 'title.en': { $regex: safeSearch, $options: 'i' } },
        { 'desc.ru': { $regex: safeSearch, $options: 'i' } },
        { 'desc.en': { $regex: safeSearch, $options: 'i' } }
      ];
    }

    if (filter) query.filter_id = filter;
    if (tag) query.$and = [{ $or: [{ tag_ids: tag }, { tag_id: tag }] }];

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const skip = (page - 1) * limit;
    const manuals = await Manual.find(query)
      .populate('filter_id')
      .populate('tag_id')
      .populate('tag_ids')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Manual.countDocuments(query);
    res.json({ manuals, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching manuals' });
  }
};

export const createManual = async (req, res) => {
  try {
    const { link } = req.body;
    const title = { ru: req.body['title.ru'] || '', en: req.body['title.en'] || '' };
    const desc = { ru: req.body['desc.ru'] || '', en: req.body['desc.en'] || '' };
    const content = { ru: req.body['content.ru'] || '', en: req.body['content.en'] || '' };

    const path_to_file = req.file ? await uploadManualFile(req.file) : '';

    const manualData = { title, desc, link, content, path_to_file };
    const filterId = req.body.filter_id;
    if (filterId && filterId.trim()) manualData.filter_id = filterId;

    const tagIds = parseTagIds(req.body.tag_ids);
    const tagId = req.body.tag_id;
    if (tagIds !== undefined) {
      manualData.tag_ids = tagIds;
      if (tagIds.length) manualData.tag_id = tagIds[0];
    } else if (tagId && tagId.trim()) {
      manualData.tag_id = tagId;
      manualData.tag_ids = [tagId];
    }

    const manual = await Manual.create(manualData);
    res.status(201).json(manual);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating manual' });
  }
};

export const updateManual = async (req, res) => {
  try {
    const { id } = req.params;
    const { link } = req.body;
    const updateData = { link };

    if (req.body['content.ru'] !== undefined || req.body['content.en'] !== undefined) {
      updateData.content = {
        ru: req.body['content.ru'] || '',
        en: req.body['content.en'] || ''
      };
    }

    const filterId = req.body.filter_id;
    updateData.filter_id = (filterId && filterId.trim()) ? filterId : null;

    const tagIds = parseTagIds(req.body.tag_ids);
    const tagId = req.body.tag_id;
    if (tagIds !== undefined) {
      updateData.tag_ids = tagIds;
      updateData.tag_id = tagIds.length ? tagIds[0] : null;
    } else {
      updateData.tag_id = (tagId && tagId.trim()) ? tagId : null;
      updateData.tag_ids = (tagId && tagId.trim()) ? [tagId] : [];
    }

    if (req.body['title.ru'] || req.body['title.en']) {
      updateData.title = { ru: req.body['title.ru'] || '', en: req.body['title.en'] || '' };
    }
    if (req.body['desc.ru'] || req.body['desc.en']) {
      updateData.desc = { ru: req.body['desc.ru'] || '', en: req.body['desc.en'] || '' };
    }

    const needsOld = req.file || updateData.content;
    if (needsOld) {
      const old = await Manual.findById(id).select('path_to_file content');
      if (req.file) {
        deleteManualFile(old?.path_to_file);
        updateData.path_to_file = await uploadManualFile(req.file);
      }
      if (updateData.content && old) {
        const oldUrls = [
          ...extractImageUrls(old.content?.ru || ''),
          ...extractImageUrls(old.content?.en || '')
        ];
        const newUrls = new Set([
          ...extractImageUrls(updateData.content.ru || ''),
          ...extractImageUrls(updateData.content.en || '')
        ]);
        for (const url of oldUrls) {
          if (!newUrls.has(url)) deleteManualFile(url);
        }
      }
    }

    const manual = await Manual.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
    res.json(manual);
  } catch (error) {
    res.status(500).json({ message: 'Error updating manual' });
  }
};

export const deleteManual = async (req, res) => {
  try {
    const manual = await Manual.findByIdAndDelete(req.params.id);
    if (manual) {
      deleteManualFile(manual.path_to_file);
      const imgUrls = [
        ...extractImageUrls(manual.content?.ru || ''),
        ...extractImageUrls(manual.content?.en || '')
      ];
      for (const url of imgUrls) deleteManualFile(url);
    }
    res.json({ message: 'Manual deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting manual' });
  }
};

export const getManualById = async (req, res) => {
  try {
    const manual = await Manual.findById(req.params.id).populate('filter_id').populate('tag_id').populate('tag_ids');
    if (!manual) return res.status(404).json({ message: 'Manual not found' });
    res.json(manual);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching manual' });
  }
};

export const uploadManualImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image uploaded' });
    const url = await uploadManualFile(req.file);
    res.json({ url });
  } catch (error) {
    res.status(500).json({ message: 'Error uploading image' });
  }
};
