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

const serviceSchema = new mongoose.Schema({
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
  sub_desc: {
    type: multilingualStringSchema,
    required: false
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  filter_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Filter',
    required: false
  },
  path_image: {
    type: String,
    default: ''
  },
  link: {
    type: String,
    default: ''
  }
}, { timestamps: true });

export default mongoose.model('Service', serviceSchema);
