import Partner from '../models/Partner.js';
import { bunnyUpload, generateFilename, getBunnyPublicUrl } from '../utils/bunnyStorage.js';
import { deleteAnyFile, extractImageUrls } from '../utils/deleteFile.js';
import { escapeRegex } from '../utils/safeQuery.js';

const deletePartnerFile = (urlOrPath) => {
  if (!urlOrPath) return;
  deleteAnyFile(urlOrPath);
};

const uploadPartnerFile = async (file) => {
  const filename = generateFilename(file.originalname);
  const remotePath = `/partners/${filename}`;
  await bunnyUpload(remotePath, file.buffer, file.mimetype);
  return getBunnyPublicUrl(remotePath);
};

/* ============ CRM (staff) ============ */

export const getPartners = async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    const safeSearch = escapeRegex(String(search).slice(0, 100));
    const query = {};

    if (safeSearch) {
      query.$or = [
        { 'title.ru': { $regex: safeSearch, $options: 'i' } },
        { 'title.en': { $regex: safeSearch, $options: 'i' } },
        { 'shortDesc.ru': { $regex: safeSearch, $options: 'i' } },
        { 'shortDesc.en': { $regex: safeSearch, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    const partners = await Partner.find(query)
      .sort({ order: 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Partner.countDocuments(query);
    res.json({ partners, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching partners' });
  }
};

export const getPartnerById = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    res.json(partner);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching partner' });
  }
};

export const createPartner = async (req, res) => {
  try {
    const title = { ru: req.body['title.ru'] || '', en: req.body['title.en'] || '' };
    const shortDesc = { ru: req.body['shortDesc.ru'] || '', en: req.body['shortDesc.en'] || '' };
    const content = { ru: req.body['content.ru'] || '', en: req.body['content.en'] || '' };
    const order = Number(req.body.order) || 0;
    const isActive = req.body.isActive !== 'false';

    const image = req.file ? await uploadPartnerFile(req.file) : '';

    const partner = await Partner.create({ title, shortDesc, content, image, order, isActive });
    res.status(201).json(partner);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating partner' });
  }
};

export const updatePartner = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {};

    if (req.body['title.ru'] !== undefined || req.body['title.en'] !== undefined) {
      updateData.title = { ru: req.body['title.ru'] || '', en: req.body['title.en'] || '' };
    }
    if (req.body['shortDesc.ru'] !== undefined || req.body['shortDesc.en'] !== undefined) {
      updateData.shortDesc = { ru: req.body['shortDesc.ru'] || '', en: req.body['shortDesc.en'] || '' };
    }
    if (req.body['content.ru'] !== undefined || req.body['content.en'] !== undefined) {
      updateData.content = { ru: req.body['content.ru'] || '', en: req.body['content.en'] || '' };
    }
    if (req.body.order !== undefined) updateData.order = Number(req.body.order) || 0;
    if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive !== 'false';

    const removeImage = req.body.removeImage === 'true' && !req.file;
    const needsOld = req.file || removeImage || updateData.content;
    if (needsOld) {
      const old = await Partner.findById(id).select('image content');
      if (req.file) {
        deletePartnerFile(old?.image);
        updateData.image = await uploadPartnerFile(req.file);
      } else if (removeImage) {
        deletePartnerFile(old?.image);
        updateData.image = '';
      }
      if (updateData.content && old) {
        const oldUrls = [
          ...extractImageUrls(old.content?.ru || '', 'partners'),
          ...extractImageUrls(old.content?.en || '', 'partners')
        ];
        const newUrls = new Set([
          ...extractImageUrls(updateData.content.ru || '', 'partners'),
          ...extractImageUrls(updateData.content.en || '', 'partners')
        ]);
        for (const url of oldUrls) {
          if (!newUrls.has(url)) deletePartnerFile(url);
        }
      }
    }

    const partner = await Partner.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    res.json(partner);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error updating partner' });
  }
};

export const deletePartner = async (req, res) => {
  try {
    const partner = await Partner.findByIdAndDelete(req.params.id);
    if (partner) {
      deletePartnerFile(partner.image);
      const imgUrls = [
        ...extractImageUrls(partner.content?.ru || '', 'partners'),
        ...extractImageUrls(partner.content?.en || '', 'partners')
      ];
      for (const url of imgUrls) deletePartnerFile(url);
    }
    res.json({ message: 'Partner deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting partner' });
  }
};

export const uploadPartnerImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image uploaded' });
    const url = await uploadPartnerFile(req.file);
    res.json({ url });
  } catch (error) {
    res.status(500).json({ message: 'Error uploading image' });
  }
};

/* ============ PUBLIC (storefront) ============ */

export const getPublicPartners = async (req, res) => {
  try {
    const partners = await Partner.find({ isActive: true })
      .select('title shortDesc image order createdAt')
      .sort({ order: 1, createdAt: -1 });
    res.json({ partners });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching partners' });
  }
};

export const getPublicPartnerById = async (req, res) => {
  try {
    const partner = await Partner.findOne({ _id: req.params.id, isActive: true });
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    res.json(partner);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching partner' });
  }
};
