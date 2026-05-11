import Manual from '../models/Manual.js';
import { deleteUploadFile, extractImageUrls } from '../utils/deleteFile.js';

export const getManuals = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', filter, tag, startDate, endDate } = req.query;
    const safeSearch = String(search).slice(0, 200);
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
    if (tag) query.tag_id = tag;

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
    const title = {
      ru: req.body['title.ru'] || '',
      en: req.body['title.en'] || ''
    };
    const desc = {
      ru: req.body['desc.ru'] || '',
      en: req.body['desc.en'] || ''
    };
    const content = {
      ru: req.body['content.ru'] || '',
      en: req.body['content.en'] || ''
    };
    const path_to_file = req.file ? `/uploads/manuals/${req.file.filename}` : '';
    
    const manualData = { title, desc, link, content, path_to_file };
    const filterId = req.body.filter_id;
    if (filterId && filterId.trim()) {
      manualData.filter_id = filterId;
    }
    const tagId = req.body.tag_id;
    if (tagId && tagId.trim()) {
      manualData.tag_id = tagId;
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
    if (filterId && filterId.trim()) {
      updateData.filter_id = filterId;
    } else {
      updateData.filter_id = null;
    }
    const tagId = req.body.tag_id;
    if (tagId && tagId.trim()) {
      updateData.tag_id = tagId;
    } else {
      updateData.tag_id = null;
    }
    
    if (req.body['title.ru'] || req.body['title.en']) {
      updateData.title = {
        ru: req.body['title.ru'] || '',
        en: req.body['title.en'] || ''
      };
    }
    if (req.body['desc.ru'] || req.body['desc.en']) {
      updateData.desc = {
        ru: req.body['desc.ru'] || '',
        en: req.body['desc.en'] || ''
      };
    }
    
    const needsOld = req.file || updateData.content;
    if (needsOld) {
      const old = await Manual.findById(id).select('path_to_file content');
      if (req.file) {
        if (old?.path_to_file) deleteUploadFile(old.path_to_file);
        updateData.path_to_file = `/uploads/manuals/${req.file.filename}`;
      }
      if (updateData.content && old) {
        const oldUrls = [
          ...extractImageUrls(old.content?.ru || ''),
          ...extractImageUrls(old.content?.en || ''),
        ];
        const newUrls = new Set([
          ...extractImageUrls(updateData.content.ru || ''),
          ...extractImageUrls(updateData.content.en || ''),
        ]);
        for (const url of oldUrls) {
          if (!newUrls.has(url)) deleteUploadFile(url);
        }
      }
    }

    const manual = await Manual.findByIdAndUpdate(id, updateData, { new: true });
    res.json(manual);
  } catch (error) {
    res.status(500).json({ message: 'Error updating manual' });
  }
};

export const deleteManual = async (req, res) => {
  try {
    const manual = await Manual.findByIdAndDelete(req.params.id);
    if (manual) {
      if (manual.path_to_file) deleteUploadFile(manual.path_to_file);
      const imgUrls = [
        ...extractImageUrls(manual.content?.ru || ''),
        ...extractImageUrls(manual.content?.en || ''),
      ];
      for (const url of imgUrls) deleteUploadFile(url);
    }
    res.json({ message: 'Manual deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting manual' });
  }
};

export const getManualById = async (req, res) => {
  try {
    const manual = await Manual.findById(req.params.id).populate('filter_id').populate('tag_id');
    if (!manual) return res.status(404).json({ message: 'Manual not found' });
    res.json(manual);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching manual' });
  }
};

export const uploadManualImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image uploaded' });
    const url = `/uploads/manuals/${req.file.filename}`;
    res.json({ url });
  } catch (error) {
    res.status(500).json({ message: 'Error uploading image' });
  }
};
