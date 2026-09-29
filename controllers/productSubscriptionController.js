import mongoose from 'mongoose';
import ProductSubscription from '../models/ProductSubscription.js';
import GoogleAdsProduct from '../models/GoogleAdsProduct.js';
import YoutubeProduct from '../models/YoutubeProduct.js';

const PRODUCT_TYPES = ['GoogleAdsProduct', 'YoutubeProduct'];

const getProductModel = (productType) => {
  if (productType === 'GoogleAdsProduct') return GoogleAdsProduct;
  if (productType === 'YoutubeProduct') return YoutubeProduct;
  return null;
};

/* ============ CUSTOMER (storefront) ============ */

// GET /customer/product-subscriptions/status?productId=&productType=
export const getSubscriptionStatus = async (req, res) => {
  try {
    const { productId, productType } = req.query;
    if (!mongoose.isValidObjectId(productId) || !PRODUCT_TYPES.includes(productType)) {
      return res.status(400).json({ message: 'Invalid product' });
    }
    const sub = await ProductSubscription.findOne({ customerId: req.customer._id, productId, productType }).select('_id');
    return res.json({ subscribed: !!sub });
  } catch (error) {
    console.error('[ProductSubscriptions] status error:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// POST /customer/product-subscriptions  { productId, productType }
export const subscribe = async (req, res) => {
  try {
    const { productId, productType } = req.body;
    if (!mongoose.isValidObjectId(productId) || !PRODUCT_TYPES.includes(productType)) {
      return res.status(400).json({ message: 'Invalid product' });
    }
    const ProductModel = getProductModel(productType);
    const exists = await ProductModel.exists({ _id: productId });
    if (!exists) return res.status(404).json({ message: 'Product not found' });

    await ProductSubscription.findOneAndUpdate(
      { customerId: req.customer._id, productId, productType },
      { customerId: req.customer._id, productId, productType },
      { upsert: true, setDefaultsOnInsert: true }
    );
    return res.json({ subscribed: true });
  } catch (error) {
    console.error('[ProductSubscriptions] subscribe error:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// DELETE /customer/product-subscriptions  { productId, productType }
export const unsubscribe = async (req, res) => {
  try {
    const { productId, productType } = req.body;
    if (!mongoose.isValidObjectId(productId) || !PRODUCT_TYPES.includes(productType)) {
      return res.status(400).json({ message: 'Invalid product' });
    }
    await ProductSubscription.deleteOne({ customerId: req.customer._id, productId, productType });
    return res.json({ subscribed: false });
  } catch (error) {
    console.error('[ProductSubscriptions] unsubscribe error:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ============ CRM (staff, Marketing → Подписки) ============ */

// GET /product-subscriptions/summary — one row per product that has at least
// one subscriber, with how many people are waiting and its current stock.
export const getSubscriptionsSummary = async (req, res) => {
  try {
    const grouped = await ProductSubscription.aggregate([
      { $group: { _id: { productId: '$productId', productType: '$productType' }, count: { $sum: 1 }, lastSubscribedAt: { $max: '$createdAt' } } },
      { $sort: { count: -1 } }
    ]);

    const byType = { GoogleAdsProduct: [], YoutubeProduct: [] };
    for (const row of grouped) {
      if (byType[row._id.productType]) byType[row._id.productType].push(row);
    }

    const productDocs = {};
    for (const productType of PRODUCT_TYPES) {
      const ids = byType[productType].map((r) => r._id.productId);
      if (!ids.length) continue;
      const ProductModel = getProductModel(productType);
      const products = await ProductModel.find({ _id: { $in: ids } }).select('title counts geos');
      productDocs[productType] = new Map(products.map((p) => [String(p._id), p]));
    }

    const items = grouped.map((row) => {
      const { productId, productType } = row._id;
      const product = productDocs[productType]?.get(String(productId));
      return {
        productId,
        productType,
        subscriberCount: row.count,
        lastSubscribedAt: row.lastSubscribedAt,
        product: product ? { _id: product._id, title: product.title, counts: product.counts, geos: product.geos } : null
      };
    }).filter((i) => i.product);

    return res.json({ items });
  } catch (error) {
    console.error('[ProductSubscriptions] summary error:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// GET /product-subscriptions?productId=&productType= — subscriber drill-down for one product.
export const getSubscribersForProduct = async (req, res) => {
  try {
    const { productId, productType } = req.query;
    if (!mongoose.isValidObjectId(productId) || !PRODUCT_TYPES.includes(productType)) {
      return res.status(400).json({ message: 'Invalid product' });
    }
    const subs = await ProductSubscription.find({ productId, productType })
      .populate('customerId', 'username email telegramUsername telegramId createdAt')
      .sort({ createdAt: -1 });
    return res.json({
      subscribers: subs
        .filter((s) => s.customerId)
        .map((s) => ({ _id: s._id, subscribedAt: s.createdAt, customer: s.customerId }))
    });
  } catch (error) {
    console.error('[ProductSubscriptions] subscribers error:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};
