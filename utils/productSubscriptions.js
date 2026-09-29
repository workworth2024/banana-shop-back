import ProductSubscription from '../models/ProductSubscription.js';
import CustomerUser from '../models/CustomerUser.js';
import { notifyCustomer } from './notify.js';

// Where a product's detail page lives on the storefront, keyed by productType.
export const PRODUCT_DETAIL_SLUG = {
  GoogleAdsProduct: 'google-ads',
  YoutubeProduct: 'youtube'
};

// "?start=gaprod_<id>" / "?start=ytprod_<id>" — matches the deep-link the bot
// (botInstance.js) parses to jump straight to that product's detail/order
// screen, so Telegram users order inside the bot instead of on the website.
const PRODUCT_DEEPLINK_PREFIX = {
  GoogleAdsProduct: 'gaprod',
  YoutubeProduct: 'ytprod'
};

export function buildProductLink(productId, productType) {
  const slug = PRODUCT_DETAIL_SLUG[productType];
  if (!slug) return null;
  return `/services/${slug}/product/${productId}`;
}

export function buildBotProductDeepLink(productId, productType) {
  const prefix = PRODUCT_DEEPLINK_PREFIX[productType];
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (!prefix || !botUsername) return null;
  return `https://t.me/${botUsername}?start=${prefix}_${productId}`;
}

/**
 * Pings every customer subscribed to (productId, productType) that it's
 * back in stock / got more available — called from syncProductCounts()
 * whenever the total available count goes up. Fire-and-forget from the
 * caller's perspective; failures for one subscriber don't block the rest.
 */
export async function notifyProductSubscribers({ productId, productType, productTitle }) {
  const subs = await ProductSubscription.find({ productId, productType }).select('customerId').lean();
  if (!subs.length) return;

  const link = buildProductLink(productId, productType);
  const telegramButtonUrl = buildBotProductDeepLink(productId, productType);
  const titleRu = productTitle?.ru || productTitle?.en || '';
  const titleEn = productTitle?.en || productTitle?.ru || '';

  const customerIds = subs.map((s) => s.customerId);
  const customers = await CustomerUser.find({ _id: { $in: customerIds } })
    .select('telegramId language')
    .lean();
  const customerById = new Map(customers.map((c) => [String(c._id), c]));

  for (const sub of subs) {
    const customer = customerById.get(String(sub.customerId));
    const lang = customer?.language === 'en' ? 'en' : 'ru';
    notifyCustomer({
      customerId: sub.customerId,
      customer,
      type: 'product_available',
      title: { ru: 'Товар снова в наличии', en: 'Back in stock' },
      message: {
        ru: `«${titleRu}» пополнили — теперь в наличии. Успейте заказать, пока не разобрали!`,
        en: `“${titleEn}” is back in stock. Grab it before it's gone!`
      },
      link,
      buttonText: lang === 'ru' ? 'Перейти к товару' : 'View product',
      telegramButtonUrl
    }).catch((e) => console.error('[ProductSubscriptions] notifyCustomer failed:', e.message));
  }
}
