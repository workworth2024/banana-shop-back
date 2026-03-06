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

const youtubeProductSchema = new mongoose.Schema({
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
    required: true,
    min: 0,
    default: 0
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
  geo: {
    type: String,
    required: false,
    default: 'US'
  }
}, { timestamps: true });

export default mongoose.model('YoutubeProduct', youtubeProductSchema);
