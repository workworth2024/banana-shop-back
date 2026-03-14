import mongoose from 'mongoose';

const preorderSchema = new mongoose.Schema({
  google_item_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GoogleAdsProduct',
    required: true
  },
  name: { type: String, required: true, trim: true },
  telegram: { type: String, required: true, trim: true },
  desired_quantity: { type: Number, required: true, min: 1 },
  comment: { type: String, default: '', trim: true },
  status: {
    type: String,
    enum: ['pending', 'canceled', 'completed'],
    default: 'pending'
  }
}, { timestamps: true });

export default mongoose.model('Preorder', preorderSchema);
