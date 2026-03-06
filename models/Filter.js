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

const filterSchema = new mongoose.Schema({
  name: {
    type: multilingualStringSchema,
    required: true,
    validate: {
      validator: function(v) {
        return v.ru || v.en;
      },
      message: 'Название фильтра должно быть заполнено на русском или английском языке'
    }
  },
  color: {
    type: String,
    required: true,
    default: '#008b8b'
  }
}, { timestamps: true });

export default mongoose.model('Filter', filterSchema);
