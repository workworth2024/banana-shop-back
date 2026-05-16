import YoutubeProduct from '../models/YoutubeProduct.js';
import GoogleAdsProduct from '../models/GoogleAdsProduct.js';
import mongoose from 'mongoose';
import { bunnyUpload, generateFilename, getBunnyPublicUrl } from '../utils/bunnyStorage.js';
import { deleteAnyFile } from '../utils/deleteFile.js';
import { escapeRegex } from '../utils/safeQuery.js';

const addDateFilter = (query, startDate, endDate) => {
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }
};

const buildSearchQuery = (search) => {
  const raw = String(search).slice(0, 100);
  const safeSearch = escapeRegex(raw);
  const conditions = [
    { 'title.ru': { $regex: safeSearch, $options: 'i' } },
    { 'title.en': { $regex: safeSearch, $options: 'i' } },
    { uid: { $regex: safeSearch, $options: 'i' } }
  ];
  if (mongoose.isValidObjectId(raw)) {
    conditions.push({ _id: new mongoose.Types.ObjectId(raw) });
  }
  return { $or: conditions };
};

/** Серверная пагинация: лимит по умолчанию и верхняя граница против выгрузки тысяч записей разом */
const parseProductListPaging = (query) => {
  const DEFAULT = 25;
  const MAX = 100;
  const pageNum = Math.max(1, parseInt(String(query.page), 10) || 1);
  let lim = parseInt(String(query.limit), 10);
  if (!Number.isFinite(lim) || lim < 1) lim = DEFAULT;
  if (lim > MAX) lim = MAX;
  const skip = (pageNum - 1) * lim;
  return { pageNum, limitNum: lim, skip };
};

const deleteProductImage = (path_image) => {
  if (!path_image) return;
  deleteAnyFile(path_image);
};

const uploadProductImage = async (file) => {
  const filename = generateFilename(file.originalname);
  const remotePath = `/products/${filename}`;
  await bunnyUpload(remotePath, file.buffer, file.mimetype);
  return getBunnyPublicUrl(remotePath);
};

// Youtube Products
export const getYoutubeProducts = async (req, res) => {
  try {
    const { search = '', filter, type, geo, startDate, endDate } = req.query;
    const query = {};
    if (search) Object.assign(query, buildSearchQuery(search));
    if (filter) query.filter_id = filter;
    if (type) query.type = type;
    if (geo) query.geo = geo;
    addDateFilter(query, startDate, endDate);

    const { pageNum, limitNum, skip } = parseProductListPaging(req.query);
    const products = await YoutubeProduct.find(query)
      .populate('filter_id')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await YoutubeProduct.countDocuments(query);
    const availableTypes = await YoutubeProduct.distinct('type');
    const availableGeos = await YoutubeProduct.distinct('geo');
    const pages = Math.ceil(total / limitNum) || 1;

    res.json({
      products,
      total,
      page: pageNum,
      limit: limitNum,
      pages,
      availableTypes: availableTypes.filter(Boolean),
      availableGeos: availableGeos.filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching Youtube products' });
  }
};

export const createYoutubeProduct = async (req, res) => {
  try {
    const { type, price, counts, geo } = req.body;
    const title = { ru: req.body['title.ru'] || '', en: req.body['title.en'] || '' };
    const desc = { ru: req.body['desc.ru'] || '', en: req.body['desc.en'] || '' };
    const link = req.body.link || '';
    const wholesale_price = req.body.wholesale_price ? parseFloat(req.body.wholesale_price) : null;
    const count_for_wholesale = req.body.count_for_wholesale ? parseInt(req.body.count_for_wholesale) : null;

    const path_image = req.file ? await uploadProductImage(req.file) : '';

    const productData = { type, title, desc, price, counts, geo, path_image, link, wholesale_price, count_for_wholesale };
    const filterId = req.body.filter_id;
    if (filterId && filterId.trim()) productData.filter_id = filterId;

    const product = await YoutubeProduct.create(productData);
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error creating Youtube product' });
  }
};

export const updateYoutubeProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, price, counts, geo } = req.body;
    const updateData = {
      type, price, counts, geo,
      link: req.body.link || '',
      wholesale_price: req.body.wholesale_price ? parseFloat(req.body.wholesale_price) : null,
      count_for_wholesale: req.body.count_for_wholesale ? parseInt(req.body.count_for_wholesale) : null
    };

    const filterId = req.body.filter_id;
    updateData.filter_id = (filterId && filterId.trim()) ? filterId : null;

    if (req.body['title.ru'] || req.body['title.en']) {
      updateData.title = { ru: req.body['title.ru'] || '', en: req.body['title.en'] || '' };
    }
    if (req.body['desc.ru'] || req.body['desc.en']) {
      updateData.desc = { ru: req.body['desc.ru'] || '', en: req.body['desc.en'] || '' };
    }

    if (req.file) {
      const old = await YoutubeProduct.findById(id).select('path_image');
      deleteProductImage(old?.path_image);
      updateData.path_image = await uploadProductImage(req.file);
    }

    const product = await YoutubeProduct.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error updating Youtube product' });
  }
};

export const deleteYoutubeProduct = async (req, res) => {
  try {
    const product = await YoutubeProduct.findByIdAndDelete(req.params.id);
    deleteProductImage(product?.path_image);
    res.json({ message: 'Youtube product deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting Youtube product' });
  }
};

export const getGoogleAdsProductById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }
    const product = await GoogleAdsProduct.findById(id).populate('filter_id');
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching product' });
  }
};

export const getGoogleAdsProducts = async (req, res) => {
  try {
    const { search = '', filter, type, geo, startDate, endDate } = req.query;
    const query = {};
    if (search) Object.assign(query, buildSearchQuery(search));
    if (filter) query.filter_id = filter;
    if (type) query.type = type;
    if (geo) query.geo = geo;
    addDateFilter(query, startDate, endDate);

    const { pageNum, limitNum, skip } = parseProductListPaging(req.query);
    const products = await GoogleAdsProduct.find(query)
      .populate('filter_id')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await GoogleAdsProduct.countDocuments(query);
    const availableTypes = await GoogleAdsProduct.distinct('type');
    const availableGeos = await GoogleAdsProduct.distinct('geo');
    const pages = Math.ceil(total / limitNum) || 1;

    res.json({
      products,
      total,
      page: pageNum,
      limit: limitNum,
      pages,
      availableTypes: availableTypes.filter(Boolean),
      availableGeos: availableGeos.filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching Google Ads products' });
  }
};

export const createGoogleAdsProduct = async (req, res) => {
  try {
    const { type, price, counts, geo } = req.body;
    const link = req.body.link || '';
    const wholesale_price = req.body.wholesale_price ? parseFloat(req.body.wholesale_price) : null;
    const count_for_wholesale = req.body.count_for_wholesale ? parseInt(req.body.count_for_wholesale) : null;
    const title = { ru: req.body['title.ru'] || '', en: req.body['title.en'] || '' };
    const sub_title = { ru: req.body['sub_title.ru'] || '', en: req.body['sub_title.en'] || '' };
    const desc = { ru: req.body['desc.ru'] || '', en: req.body['desc.en'] || '' };
    const inclusive = { ru: req.body['inclusive.ru'] || '', en: req.body['inclusive.en'] || '' };
    const receive = { ru: req.body['receive.ru'] || '', en: req.body['receive.en'] || '' };

    const path_image = req.file ? await uploadProductImage(req.file) : '';

    const productData = { type, title, sub_title, desc, inclusive, receive, price, counts, geo, path_image, link, wholesale_price, count_for_wholesale };
    const filterId = req.body.filter_id;
    if (filterId && filterId.trim()) productData.filter_id = filterId;

    const product = await GoogleAdsProduct.create(productData);
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error creating Google Ads product' });
  }
};

export const updateGoogleAdsProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, price, counts, geo } = req.body;
    const updateData = {
      type, price, counts, geo,
      link: req.body.link || '',
      wholesale_price: req.body.wholesale_price ? parseFloat(req.body.wholesale_price) : null,
      count_for_wholesale: req.body.count_for_wholesale ? parseInt(req.body.count_for_wholesale) : null
    };

    const filterId = req.body.filter_id;
    updateData.filter_id = (filterId && filterId.trim()) ? filterId : null;

    if (req.body['title.ru'] || req.body['title.en']) {
      updateData.title = { ru: req.body['title.ru'] || '', en: req.body['title.en'] || '' };
    }
    if (req.body['sub_title.ru'] || req.body['sub_title.en']) {
      updateData.sub_title = { ru: req.body['sub_title.ru'] || '', en: req.body['sub_title.en'] || '' };
    }
    if (req.body['desc.ru'] || req.body['desc.en']) {
      updateData.desc = { ru: req.body['desc.ru'] || '', en: req.body['desc.en'] || '' };
    }
    if (req.body['inclusive.ru'] || req.body['inclusive.en']) {
      updateData.inclusive = { ru: req.body['inclusive.ru'] || '', en: req.body['inclusive.en'] || '' };
    }
    if (req.body['receive.ru'] || req.body['receive.en']) {
      updateData.receive = { ru: req.body['receive.ru'] || '', en: req.body['receive.en'] || '' };
    }

    if (req.file) {
      const old = await GoogleAdsProduct.findById(id).select('path_image');
      deleteProductImage(old?.path_image);
      updateData.path_image = await uploadProductImage(req.file);
    }

    const product = await GoogleAdsProduct.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error updating Google Ads product' });
  }
};

export const deleteGoogleAdsProduct = async (req, res) => {
  try {
    const product = await GoogleAdsProduct.findByIdAndDelete(req.params.id);
    deleteProductImage(product?.path_image);
    res.json({ message: 'Google Ads product deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting Google Ads product' });
  }
};
