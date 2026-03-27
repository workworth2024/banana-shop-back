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

const manualTagSchema = new mongoose.Schema({
  name: {
    type: multilingualStringSchema,
    required: true,
    validate: {
      validator: function(v) {
        return v.ru || v.en;
      },
      message: 'Название тега должно быть заполнено на русском или английском языке'
    }
  }
}, { timestamps: true });

export default mongoose.model('ManualTag', manualTagSchema);
