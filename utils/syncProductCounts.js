import DigitalItem from '../models/DigitalItem.js';
import GoogleAdsProduct from '../models/GoogleAdsProduct.js';
import YoutubeProduct from '../models/YoutubeProduct.js';
import { io } from '../server.js';
import { notifyProductSubscribers } from './productSubscriptions.js';

const getProductModel = (productType) => {
  if (productType === 'GoogleAdsProduct') return GoogleAdsProduct;
  if (productType === 'YoutubeProduct') return YoutubeProduct;
  return null;
};

export const syncProductCounts = async (productId, productType) => {
  const ProductModel = getProductModel(productType);
  if (!ProductModel) return { total: 0, geos: [] };
  const product = await ProductModel.findById(productId).select('geos counts title');
  if (!product) return { total: 0, geos: [] };
  const previousTotal = Number(product.counts) || 0;
  const geoCodes = Array.isArray(product.geos) ? product.geos.map(g => g.code) : [];
  const updatedGeos = [];
  for (const code of geoCodes) {
    const c = await DigitalItem.countDocuments({ productId, productType, geo: code, status: 'available' });
    updatedGeos.push({ code, counts: c });
  }
  const total = updatedGeos.reduce((s, g) => s + g.counts, 0);
  await ProductModel.findByIdAndUpdate(productId, { geos: updatedGeos, counts: total });
  try {
    io.of('/customer').emit('product_updated', {
      productId: String(productId),
      productType,
      geos: updatedGeos,
      counts: total
    });
  } catch (_) {}

  // Restocked / availability went up — ping anyone subscribed to this product.
  if (total > previousTotal) {
    notifyProductSubscribers({ productId, productType, productTitle: product.title }).catch((e) => {
      console.error('[ProductSubscriptions] notify error:', e.message);
    });
  }

  return { total, geos: updatedGeos };
};

export const syncManyProductCounts = async (items) => {
  const seen = new Set();
  for (const { productId, productType } of items) {
    const key = `${productId}:${productType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await syncProductCounts(productId, productType).catch(() => {});
  }
};
