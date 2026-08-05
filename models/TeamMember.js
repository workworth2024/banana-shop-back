import mongoose from 'mongoose';

const multilingualStringSchema = new mongoose.Schema({
  ru: { type: String, default: '' },
  en: { type: String, default: '' }
}, { _id: false });

const teamMemberSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  position: {
    type: multilingualStringSchema,
    default: () => ({ ru: '', en: '' })
  },
  photo: { type: String, default: '' },
  socialLabel: { type: String, default: '', trim: true },
  socialLink: { type: String, default: '', trim: true },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

teamMemberSchema.index({ sortOrder: 1, createdAt: 1 });

export default mongoose.model('TeamMember', teamMemberSchema);
