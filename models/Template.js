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

const templateSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    sparse: true,
    default: () => 'TPL-' + crypto.randomBytes(4).toString('hex').toUpperCase()
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
  content: {
    type: multilingualStringSchema,
    required: true,
    validate: {
      validator: function(v) {
        return v.ru || v.en;
      },
      message: 'Содержимое должно быть заполнено на русском или английском языке'
    }
  }
}, { timestamps: true });

export default mongoose.model('Template', templateSchema);
