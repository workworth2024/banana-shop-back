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

const youtubeProductSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    sparse: true,
    default: () => 'YT-' + crypto.randomBytes(4).toString('hex').toUpperCase()
  },
  type: {
    type: String,
    enum: ['service', 'item'],
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
  price: {
    type: Number,
    required: true,
    min: 0
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
  path_image: {
    type: String,
    required: false
  },
  filter_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Filter',
    required: false
  },
  link: {
    type: String,
    default: ''
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

export default mongoose.model('YoutubeProduct', youtubeProductSchema);
