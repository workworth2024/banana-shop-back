import mongoose from 'mongoose';

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
  type: {
    type: String,
    enum: ['self-farm', 'autofarm', 'spend'],
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
  get: {
    type: multilingualStringSchema,
    required: false
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
  counts: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  filter_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Filter',
    required: false
  },
  geo: {
    type: String,
    required: false,
    default: 'US'
  },
  link: {
    type: String,
    default: ''
  },
  wholesale_price: {
    type: Number,
    required: false,
    min: 0,
    default: null
  },
  count_for_wholesale: {
    type: Number,
    required: false,
    min: 0,
    default: null
  }
}, { timestamps: true });

export default mongoose.model('GoogleAdsProduct', googleAdsProductSchema);
