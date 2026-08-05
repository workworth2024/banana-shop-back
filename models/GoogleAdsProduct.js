import mongoose from 'mongoose';
import crypto from 'crypto';

const multilingualStringSchema = new mongoose.Schema({
  ru: {
    type: String,
    trim: true
  },
  en: {
    type: String,
    trim: true
  }
}, { _id: false });

const googleAdsProductSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    sparse: true,
    default: () => 'GADS-' + crypto.randomBytes(4).toString('hex').toUpperCase()
  },
  type: {
    type: String,
    enum: [
      'self-reg-farm-no-num',
      'self-reg-farm-rent-num',
      'verif-identity-only',
      'low-bill-spend-10',
      'high-bill-spend-20',
      'high-bill-wp-spend',
      'g2rs-finance-spend',
      'old-spended-heavy',
      'no-farm'
    ],
    required: true
  },
  title: {
    type: multilingualStringSchema,
    required: true,
    validate: {
      validator: function(v) {
        return v.ru || v.en;
      },
      message: 'Название должно быть заполнено на русском или английском языке'
    }
  },
  sub_title: {
    type: multilingualStringSchema,
    required: false
  },
  desc: {
    type: multilingualStringSchema,
    required: true,
    validate: {
      validator: function(v) {
        return v.ru || v.en;
      },
      message: 'Описание должно быть заполнено на русском или английском языке'
    }
  },
  inclusive: {
    type: multilingualStringSchema,
    required: false
  },
  receive: {
    type: multilingualStringSchema,
    required: false
  },
  payment: {
    type: multilingualStringSchema,
    required: false
  },
  features: {
    type: [multilingualStringSchema],
    default: []
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  path_image: {
    type: String,
    required: false
  },
  path_images: {
    type: [String],
    default: []
  },
  counts: {
    type: Number,
    required: false,
    min: 0,
    default: 0
  },
  geos: {
    type: [{
      code: { type: String, required: true, uppercase: true, trim: true },
      counts: { type: Number, default: 0, min: 0 }
    }],
    default: []
  },
  filter_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Filter',
    required: false
  },
  templateIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Template' }],
    default: []
  },
  serviceIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
    default: []
  },
  link: {
    type: String,
    default: ''
  },
  /** Позиция товара в каталоге: меньше = выше. Товары без ручной позиции (1000000) идут после, отсортированные по новизне */
  sort_order: {
    type: Number,
    default: 1000000,
    min: 0,
    index: true
  },
  price_tiers: {
    type: [{
      min_qty: { type: Number, required: true, min: 2 },
      price: { type: Number, required: true, min: 0 }
    }],
    default: [],
    validate: {
      validator: function(tiers) {
        if (!Array.isArray(tiers) || tiers.length === 0) return true;
        let prevQty = 1;
        let prevPrice = this.price;
        for (const t of tiers) {
          if (!(t.min_qty > prevQty)) return false;
          if (!(t.price < prevPrice)) return false;
          prevQty = t.min_qty;
          prevPrice = t.price;
        }
        return true;
      },
      message: 'Уровни опт. цен должны иметь возрастающее количество и убывающую цену относительно базовой'
    }
  }
}, { timestamps: true });

export default mongoose.model('GoogleAdsProduct', googleAdsProductSchema);
