import YoutubeProduct from '../models/YoutubeProduct.js';
import GoogleAdsProduct from '../models/GoogleAdsProduct.js';

// Helper for date filter
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

// Youtube Products
export const getYoutubeProducts = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', filter, type, geo, startDate, endDate } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { 'title.ru': { $regex: search, $options: 'i' } },
        { 'title.en': { $regex: search, $options: 'i' } }
      ];
    }
    if (filter) query.filter_id = filter;
    if (type) query.type = type;
    if (geo) query.geo = geo;
    addDateFilter(query, startDate, endDate);

    const skip = (page - 1) * limit;
    const products = await YoutubeProduct.find(query)
      .populate('filter_id')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await YoutubeProduct.countDocuments(query);
    
    const availableTypes = await YoutubeProduct.distinct('type');
    const availableGeos = await YoutubeProduct.distinct('geo');

    res.json({ products, total, pages: Math.ceil(total / limit), availableTypes: availableTypes.filter(Boolean), availableGeos: availableGeos.filter(Boolean) });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching Youtube products' });
  }
};

export const createYoutubeProduct = async (req, res) => {
  try {
    const { type, price, counts, geo } = req.body;
    const title = {
      ru: req.body['title.ru'] || '',
      en: req.body['title.en'] || ''
    };
    const desc = {
      ru: req.body['desc.ru'] || '',
      en: req.body['desc.en'] || ''
    };
    const path_image = req.file ? `/uploads/${req.file.filename}` : '';
    const link = req.body.link || '';
    const wholesale_price = req.body.wholesale_price ? parseFloat(req.body.wholesale_price) : null;
    const count_for_wholesale = req.body.count_for_wholesale ? parseInt(req.body.count_for_wholesale) : null;
    
    const productData = { type, title, desc, price, counts, geo, path_image, link, wholesale_price, count_for_wholesale };
    const filterId = req.body.filter_id;
    if (filterId && filterId.trim()) {
      productData.filter_id = filterId;
    }
    
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
    if (filterId && filterId.trim()) {
      updateData.filter_id = filterId;
    } else {
      updateData.filter_id = null;
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
    
    if (req.file) updateData.path_image = `/uploads/${req.file.filename}`;
    const product = await YoutubeProduct.findByIdAndUpdate(id, updateData, { new: true });
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error updating Youtube product' });
  }
};

export const deleteYoutubeProduct = async (req, res) => {
  try {
    await YoutubeProduct.findByIdAndDelete(req.params.id);
    res.json({ message: 'Youtube product deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting Youtube product' });
  }
};

// Google Ads Products
export const getGoogleAdsProducts = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', filter, type, geo, startDate, endDate } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { 'title.ru': { $regex: search, $options: 'i' } },
        { 'title.en': { $regex: search, $options: 'i' } }
      ];
    }
    if (filter) query.filter_id = filter;
    if (type) query.type = type;
    if (geo) query.geo = geo;
    addDateFilter(query, startDate, endDate);

    const skip = (page - 1) * limit;
    const products = await GoogleAdsProduct.find(query)
      .populate('filter_id')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await GoogleAdsProduct.countDocuments(query);
    
    const availableTypes = await GoogleAdsProduct.distinct('type');
    const availableGeos = await GoogleAdsProduct.distinct('geo');

    res.json({ products, total, pages: Math.ceil(total / limit), availableTypes: availableTypes.filter(Boolean), availableGeos: availableGeos.filter(Boolean) });
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
    const title = {
      ru: req.body['title.ru'] || '',
      en: req.body['title.en'] || ''
    };
    const sub_title = {
      ru: req.body['sub_title.ru'] || '',
      en: req.body['sub_title.en'] || ''
    };
    const desc = {
      ru: req.body['desc.ru'] || '',
      en: req.body['desc.en'] || ''
    };
    const inclusive = {
      ru: req.body['inclusive.ru'] || '',
      en: req.body['inclusive.en'] || ''
    };
    const get = {
      ru: req.body['get.ru'] || '',
      en: req.body['get.en'] || ''
    };
    const path_image = req.file ? `/uploads/${req.file.filename}` : '';
    
    const productData = { type, title, sub_title, desc, inclusive, get, price, counts, geo, path_image, link, wholesale_price, count_for_wholesale };
    const filterId = req.body.filter_id;
    if (filterId && filterId.trim()) {
      productData.filter_id = filterId;
    }
    
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
    if (filterId && filterId.trim()) {
      updateData.filter_id = filterId;
    } else {
      updateData.filter_id = null;
    }
    
    if (req.body['title.ru'] || req.body['title.en']) {
      updateData.title = {
        ru: req.body['title.ru'] || '',
        en: req.body['title.en'] || ''
      };
    }
    if (req.body['sub_title.ru'] || req.body['sub_title.en']) {
      updateData.sub_title = {
        ru: req.body['sub_title.ru'] || '',
        en: req.body['sub_title.en'] || ''
      };
    }
    if (req.body['desc.ru'] || req.body['desc.en']) {
      updateData.desc = {
        ru: req.body['desc.ru'] || '',
        en: req.body['desc.en'] || ''
      };
    }
    if (req.body['inclusive.ru'] || req.body['inclusive.en']) {
      updateData.inclusive = {
        ru: req.body['inclusive.ru'] || '',
        en: req.body['inclusive.en'] || ''
      };
    }
    if (req.body['get.ru'] || req.body['get.en']) {
      updateData.get = {
        ru: req.body['get.ru'] || '',
        en: req.body['get.en'] || ''
      };
    }
    
    if (req.file) updateData.path_image = `/uploads/${req.file.filename}`;
    const product = await GoogleAdsProduct.findByIdAndUpdate(id, updateData, { new: true });
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error updating Google Ads product' });
  }
};

export const deleteGoogleAdsProduct = async (req, res) => {
  try {
    await GoogleAdsProduct.findByIdAndDelete(req.params.id);
    res.json({ message: 'Google Ads product deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting Google Ads product' });
  }
};
