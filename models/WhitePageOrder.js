import mongoose from 'mongoose';

const whitePageOrderSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true,
    index: true
  },
  uniqueId: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    // Not a fixed enum: the external platform's /types catalogue can grow
    // (landing-page, blog, shop, news, casino, ...) without a redeploy here.
    type: String,
    default: 'landing-page'
  },
  frame: { type: String, default: 'html' },
  theme: { type: String, default: '' },
  geo: { type: String, default: '' },
  language: { type: String, default: '' },
  prompt: { type: String, default: '' },
  companyName: { type: String, default: '' },
  domainName: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  address: { type: String, default: '' },
  financeLicense: { type: String, default: '' },
  financeLicenseUrl: { type: String, default: '' },
  fbPixel: { type: String, default: '' },
  googleAdsTag: { type: String, default: '' },
  googleSiteVerification: { type: String, default: '' },
  stopwords: { type: [String], default: [] },
  keywords: { type: [String], default: [] },
  note: { type: String, default: '' },
  archiveLabel: { type: String, default: '' },
  price: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['on-generate', 'completed', 'failed'],
    default: 'on-generate'
  },
  regenUsed: { type: Boolean, default: false },
  lastError: { type: String, default: '' }
}, { timestamps: true });

whitePageOrderSchema.index({ customerId: 1, createdAt: -1 });

export default mongoose.model('WhitePageOrder', whitePageOrderSchema);
