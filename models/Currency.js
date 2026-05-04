import mongoose from 'mongoose';

const currencySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  symbol: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  isDefault: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

export default mongoose.model('Currency', currencySchema);
