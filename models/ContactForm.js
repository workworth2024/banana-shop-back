import mongoose from 'mongoose';

const contactFormSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  telegram: { type: String, required: true, trim: true },
  email: { type: String, default: '', trim: true },
  message: { type: String, required: true, trim: true },
  status: { type: String, enum: ['Pending', 'Answered'], default: 'Pending' }
}, { timestamps: true });

export default mongoose.model('ContactForm', contactFormSchema);
