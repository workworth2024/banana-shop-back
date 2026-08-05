import YoutubeProduct from '../models/YoutubeProduct.js';
import GoogleAdsProduct from '../models/GoogleAdsProduct.js';
import mongoose from 'mongoose';
import { bunnyUpload, generateFilename, getBunnyPublicUrl } from '../utils/bunnyStorage.js';
import { deleteAnyFile } from '../utils/deleteFile.js';
import { escapeRegex } from '../utils/safeQuery.js';
import { sanitizeGeos } from '../utils/geos.js';
import { syncProductCounts } from '../utils/syncProductCounts.js';
import { parsePriceTiers } from '../utils/pricing.js';
import { io } from '../server.js';

const parseGeosFromBody = (body) => {
  let raw = body.geos;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  return sanitizeGeos(raw);
};

const mergeGeoCounts = (selectedGeos, existingGeos) => {
  const prev = new Map((Array.isArray(existingGeos) ? existingGeos : []).map(g => [g.code, Number(g.counts) || 0]));
  return (Array.isArray(selectedGeos) ? selectedGeos : []).map(g => ({ code: g.code, counts: prev.get(g.code) || 0 }));
};

const parseIdArrayFromBody = (raw) => {
  if (raw === undefined || raw === null) return [];
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      raw = Array.isArray(parsed) ? parsed : s.split(',');
    } catch {
      raw = s.split(',');
    }
  }
  if (!Array.isArray(raw)) raw = [raw];
  return raw
    .map(v => String(v).trim())
    .filter(v => mongoose.isValidObjectId(v));
};

const parseFeaturesFromBody = (body) => {
  let raw = body.features;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const ru = String(item.ru || '').trim().slice(0, 80);
    const en = String(item.en || '').trim().slice(0, 80);
    if (!ru && !en) continue;
    out.push({ ru, en });
  }
  return out;
};

const splitMultiParam = (val) =>
  String(val || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 30);

const buildPriceRangeFilter = (val) => {
  const ranges = splitMultiParam(val)
    .map(part => {
      const [min, max] = part.split('-').map(n => parseFloat(n));
      const cond = {};
      if (Number.isFinite(min)) cond.$gte = min;
      if (Number.isFinite(max)) cond.$lte = max;
      return Object.keys(cond).length ? { price: cond } : null;
    })
    .filter(Boolean);
  return ranges.length ? { $or: ranges } : null;
};

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

const parseImagesOrderFromBody = (body) => {
  let raw = body.imagesOrder;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(v => String(v)).filter(Boolean);
};

/**
 * Собирает итоговый массив path_images из существующих изображений и новых файлов,
 * сохраняя порядок, заданный админкой (imagesOrder), где новые файлы помечены как __new__:<index>.
 * Первый элемент массива считается обложкой (главным фото).
 */
const buildPathImages = async (req, existingImages) => {
  const files = req.files || [];
  const order = parseImagesOrderFromBody(req.body);
  const uploadedUrls = await Promise.all(files.map(f => uploadProductImage(f)));

  let path_images;
  if (order.length) {
    const existingSet = new Set(existingImages || []);
    path_images = order
      .map(entry => {
        if (entry.startsWith('__new__:')) {
          const idx = parseInt(entry.split(':')[1], 10);
          return Number.isInteger(idx) ? uploadedUrls[idx] : null;
        }
        return existingSet.has(entry) ? entry : null;
      })
      .filter(Boolean);
  } else {
    path_images = [...(existingImages || []), ...uploadedUrls];
  }

  const removed = (existingImages || []).filter(u => !path_images.includes(u));
  removed.forEach(deleteProductImage);

  return path_images;
};

// Youtube Products
export const getYoutubeProducts = async (req, res) => {
  try {
    const { search = '', filter, type, geo, startDate, endDate } = req.query;
    const query = {};
    if (search) Object.assign(query, buildSearchQuery(search));
    if (filter) query.filter_id = filter;
    if (type) query.type = type;
    if (geo) query['geos.code'] = String(geo).toUpperCase();
    addDateFilter(query, startDate, endDate);

    const { pageNum, limitNum, skip } = parseProductListPaging(req.query);
    const products = await YoutubeProduct.find(query)
      .populate('filter_id')
      .sort({ sort_order: 1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await YoutubeProduct.countDocuments(query);
    const availableTypes = await YoutubeProduct.distinct('type');
    const availableGeos = await YoutubeProduct.distinct('geos.code');
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
    const { type, price } = req.body;
    const title = { ru: req.body['title.ru'] || '', en: req.body['title.en'] || '' };
    const desc = { ru: req.body['desc.ru'] || '', en: req.body['desc.en'] || '' };
    const link = req.body.link || '';
    let price_tiers;
    try {
      price_tiers = parsePriceTiers(req.body.price_tiers, price);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    const path_image = req.file ? await uploadProductImage(req.file) : '';
    const geos = mergeGeoCounts(parseGeosFromBody(req.body), []);
    const counts = 0;

    const productData = { type, title, desc, price, counts, geos, path_image, link, price_tiers };
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
    const { type, price } = req.body;
    const existing = await YoutubeProduct.findById(id).select('geos path_image');
    const geos = mergeGeoCounts(parseGeosFromBody(req.body), existing?.geos);
    let price_tiers;
    try {
      price_tiers = parsePriceTiers(req.body.price_tiers, price);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
    const updateData = {
      type, price, geos,
      link: req.body.link || '',
      price_tiers
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
      deleteProductImage(existing?.path_image);
      updateData.path_image = await uploadProductImage(req.file);
    }

    await YoutubeProduct.findByIdAndUpdate(id, updateData);
    await syncProductCounts(id, 'YoutubeProduct');
    const product = await YoutubeProduct.findById(id);
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
    const product = await GoogleAdsProduct.findById(id)
      .populate('filter_id')
      .populate('templateIds')
      .populate({ path: 'serviceIds', populate: { path: 'scenarioId' } });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching product' });
  }
};

export const getGoogleAdsProducts = async (req, res) => {
  try {
    const { search = '', filter, type, geo, payment, feature, price, inStock, stock, sort, startDate, endDate } = req.query;
    const andConditions = [];
    if (search) andConditions.push(buildSearchQuery(search));
    const query = {};
    if (filter) query.filter_id = filter;
    if (type) query.type = type;
    const geoVals = splitMultiParam(geo).map(g => String(g).toUpperCase());
    if (geoVals.length === 1) query['geos.code'] = geoVals[0];
    else if (geoVals.length > 1) query['geos.code'] = { $in: geoVals };

    const stockMode = String(stock || '').toLowerCase();
    if (stockMode === 'instock' || inStock === 'true' || inStock === '1') query.counts = { $gt: 0 };
    else if (stockMode === 'preorder') query.counts = { $lte: 0 };

    const paymentVals = splitMultiParam(payment);
    if (paymentVals.length) {
      andConditions.push({ $or: [
        { 'payment.ru': { $in: paymentVals } },
        { 'payment.en': { $in: paymentVals } }
      ] });
    }
    const featureVals = splitMultiParam(feature);
    if (featureVals.length) {
      andConditions.push({ $or: [
        { 'features.ru': { $in: featureVals } },
        { 'features.en': { $in: featureVals } }
      ] });
    }
    const priceFilter = buildPriceRangeFilter(price);
    if (priceFilter) andConditions.push(priceFilter);

    addDateFilter(query, startDate, endDate);
    if (andConditions.length) query.$and = andConditions;

    const sortMode = String(sort || '').toLowerCase();
    const sortStage =
      sortMode === 'price_asc' ? { price: 1 } :
      sortMode === 'price_desc' ? { price: -1 } :
      sortMode === 'newest' ? { createdAt: -1 } :
      { sort_order: 1, createdAt: -1 };

    const { pageNum, limitNum, skip } = parseProductListPaging(req.query);
    const products = await GoogleAdsProduct.find(query)
      .populate('filter_id')
      .sort(sortStage)
      .skip(skip)
      .limit(limitNum);

    const total = await GoogleAdsProduct.countDocuments(query);
    // Типы в порядке лучшей позиции их товаров, чтобы группы на витрине следовали ручному порядку
    const typeAgg = await GoogleAdsProduct.aggregate([
      { $group: {
        _id: '$type',
        minOrder: { $min: { $ifNull: ['$sort_order', 1000000] } },
        newest: { $max: '$createdAt' }
      } },
      { $sort: { minOrder: 1, newest: -1 } }
    ]);
    const availableTypes = typeAgg.map(t => t._id).filter(Boolean);
    const availableGeos = await GoogleAdsProduct.distinct('geos.code');

    const priceRangeAgg = await GoogleAdsProduct.aggregate([
      { $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }
    ]);
    const availablePriceRange = {
      min: Math.floor(priceRangeAgg[0]?.min ?? 0),
      max: Math.ceil(priceRangeAgg[0]?.max ?? 0)
    };

    const paymentAgg = await GoogleAdsProduct.aggregate([
      { $match: { $or: [
        { 'payment.ru': { $nin: [null, ''] } },
        { 'payment.en': { $nin: [null, ''] } }
      ] } },
      { $group: { _id: { ru: '$payment.ru', en: '$payment.en' } } }
    ]);
    const availablePayments = paymentAgg
      .map(p => ({ ru: p._id.ru || '', en: p._id.en || '' }))
      .filter(p => p.ru || p.en);

    const featureAgg = await GoogleAdsProduct.aggregate([
      { $unwind: '$features' },
      { $group: { _id: { ru: '$features.ru', en: '$features.en' } } }
    ]);
    const availableFeatures = featureAgg
      .map(f => ({ ru: f._id.ru || '', en: f._id.en || '' }))
      .filter(f => f.ru || f.en);

    const pages = Math.ceil(total / limitNum) || 1;

    res.json({
      products,
      total,
      page: pageNum,
      limit: limitNum,
      pages,
      availableTypes: availableTypes.filter(Boolean),
      availableGeos: availableGeos.filter(Boolean),
      availablePayments,
      availableFeatures,
      availablePriceRange
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching Google Ads products' });
  }
};

export const createGoogleAdsProduct = async (req, res) => {
  try {
    const { type, price } = req.body;
    const link = req.body.link || '';
    let price_tiers;
    try {
      price_tiers = parsePriceTiers(req.body.price_tiers, price);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
    const title = { ru: req.body['title.ru'] || '', en: req.body['title.en'] || '' };
    const sub_title = { ru: req.body['sub_title.ru'] || '', en: req.body['sub_title.en'] || '' };
    const desc = { ru: req.body['desc.ru'] || '', en: req.body['desc.en'] || '' };
    const inclusive = { ru: req.body['inclusive.ru'] || '', en: req.body['inclusive.en'] || '' };
    const receive = { ru: req.body['receive.ru'] || '', en: req.body['receive.en'] || '' };
    const payment = { ru: req.body['payment.ru'] || '', en: req.body['payment.en'] || '' };
    const features = parseFeaturesFromBody(req.body);

    const path_images = await buildPathImages(req, []);
    const path_image = path_images[0] || '';
    const geos = mergeGeoCounts(parseGeosFromBody(req.body), []);
    const counts = 0;

    const productData = { type, title, sub_title, desc, inclusive, receive, payment, features, price, counts, geos, path_image, path_images, link, price_tiers };
    productData.templateIds = parseIdArrayFromBody(req.body.templateIds);
    productData.serviceIds = parseIdArrayFromBody(req.body.serviceIds);
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
    const { type, price } = req.body;
    const existing = await GoogleAdsProduct.findById(id).select('geos path_image path_images');
    const geos = mergeGeoCounts(parseGeosFromBody(req.body), existing?.geos);
    let price_tiers;
    try {
      price_tiers = parsePriceTiers(req.body.price_tiers, price);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
    const updateData = {
      type, price, geos,
      link: req.body.link || '',
      price_tiers
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
    updateData.payment = { ru: req.body['payment.ru'] || '', en: req.body['payment.en'] || '' };
    if (req.body.features !== undefined) {
      updateData.features = parseFeaturesFromBody(req.body);
    }
    if (req.body.templateIds !== undefined) {
      updateData.templateIds = parseIdArrayFromBody(req.body.templateIds);
    }
    if (req.body.serviceIds !== undefined) {
      updateData.serviceIds = parseIdArrayFromBody(req.body.serviceIds);
    }

    if (req.body.imagesOrder !== undefined || (req.files && req.files.length)) {
      const existingImages = (existing?.path_images && existing.path_images.length)
        ? existing.path_images
        : (existing?.path_image ? [existing.path_image] : []);
      const path_images = await buildPathImages(req, existingImages);
      updateData.path_images = path_images;
      updateData.path_image = path_images[0] || '';
    }

    await GoogleAdsProduct.findByIdAndUpdate(id, updateData);
    await syncProductCounts(id, 'GoogleAdsProduct');
    const product = await GoogleAdsProduct.findById(id);
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error updating Google Ads product' });
  }
};

export const deleteGoogleAdsProduct = async (req, res) => {
  try {
    const product = await GoogleAdsProduct.findByIdAndDelete(req.params.id);
    const images = (product?.path_images && product.path_images.length)
      ? product.path_images
      : (product?.path_image ? [product.path_image] : []);
    images.forEach(deleteProductImage);
    res.json({ message: 'Google Ads product deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting Google Ads product' });
  }
};

// ===== Конструктор позиций товаров =====

const MAX_POSITIONS = 500;

/** Лёгкий список всех товаров для конструктора позиций (без пагинации, минимум полей) */
const makeGetPositions = (Model) => async (req, res) => {
  try {
    const products = await Model.find({})
      .select('uid type title price path_image counts sort_order filter_id')
      .populate('filter_id', 'name color')
      .sort({ sort_order: 1, createdAt: -1 })
      .limit(MAX_POSITIONS)
      .lean();
    res.json({ products, total: products.length });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching product positions' });
  }
};

/** Принимает упорядоченный массив id и присваивает sort_order = позиция (1..N) */
const makeReorderProducts = (Model, productType) => async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.order) ? req.body.order : [];
    const ids = [...new Set(raw.map(v => String(v).trim()))]
      .filter(v => mongoose.isValidObjectId(v))
      .slice(0, MAX_POSITIONS);
    if (!ids.length) {
      return res.status(400).json({ message: 'Order list is empty or invalid' });
    }
    const ops = ids.map((id, idx) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { sort_order: idx + 1 } }
      }
    }));
    const result = await Model.bulkWrite(ops, { ordered: false });
    // Товары без поля sort_order (созданные до фичи) не должны всплывать выше ранжированных
    await Model.updateMany({ sort_order: { $exists: false } }, { $set: { sort_order: 1000000 } });
    // Витрина подхватывает новый порядок в реальном времени
    try {
      io.of('/customer').emit('products_reordered', { productType });
    } catch (_) {}
    res.json({ message: 'Positions updated', updated: result.modifiedCount ?? 0, total: ids.length });
  } catch (error) {
    res.status(500).json({ message: 'Error updating product positions' });
  }
};

export const getYoutubePositions = makeGetPositions(YoutubeProduct);
export const reorderYoutubeProducts = makeReorderProducts(YoutubeProduct, 'YoutubeProduct');
export const getGoogleAdsPositions = makeGetPositions(GoogleAdsProduct);
export const reorderGoogleAdsProducts = makeReorderProducts(GoogleAdsProduct, 'GoogleAdsProduct');
