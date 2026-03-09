import mongoose from 'mongoose';

const multilingualStringSchema = new mongoose.Schema({
  ru: { type: String },
  en: { type: String }
}, { _id: false });

const reviewSchema = new mongoose.Schema({
  text: {
    type: multilingualStringSchema,
    required: true,
    validate: {
      validator: function(v) { return v.ru || v.en; },
      message: 'Текст должен быть заполнен на русском или английском языке'
    }
  },
  link: { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('Review', reviewSchema);
