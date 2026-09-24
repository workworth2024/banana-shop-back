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

const partnerSchema = new mongoose.Schema({
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
  // Short blurb shown on the partner card in the list (before "Подробнее")
  shortDesc: {
    type: multilingualStringSchema,
    required: true,
    validate: {
      validator: function(v) {
        return v.ru || v.en;
      },
      message: 'Мини-описание должно быть заполнено на русском или английском языке'
    }
  },
  // Full article (rich text / raw HTML blocks) shown on the partner detail page
  content: {
    type: multilingualStringSchema,
    required: false
  },
  image: {
    type: String,
    default: ''
  },
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  tag_ids: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PartnerTag' }],
    default: []
  }
}, { timestamps: true });

partnerSchema.index({ isActive: 1, order: 1, createdAt: -1 });

export default mongoose.model('Partner', partnerSchema);
