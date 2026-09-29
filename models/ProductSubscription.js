import mongoose from 'mongoose';

// "Notify me when back in stock / restocked" subscription — a customer can
// subscribe to a specific product (Google Ads or YouTube) from its detail
// page and gets pinged (site notification + Telegram, if linked) whenever
// syncProductCounts() sees its total available count go up.
const productSubscriptionSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true,
    index: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  productType: {
    type: String,
    enum: ['GoogleAdsProduct', 'YoutubeProduct'],
    required: true
  }
}, { timestamps: true });

productSubscriptionSchema.index({ customerId: 1, productId: 1, productType: 1 }, { unique: true });
productSubscriptionSchema.index({ productId: 1, productType: 1 });

export default mongoose.model('ProductSubscription', productSubscriptionSchema);
