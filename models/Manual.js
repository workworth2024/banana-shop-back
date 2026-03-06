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

const manualSchema = new mongoose.Schema({
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
  link: {
    type: String,
    default: ''
  },
  path_to_file: {
    type: String,
    default: ''
  },
  filter_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Filter',
    required: false
  }
}, { timestamps: true });

export default mongoose.model('Manual', manualSchema);
