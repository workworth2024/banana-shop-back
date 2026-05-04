import mongoose from 'mongoose';

const customerSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerUser',
    required: true
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  expire: {
    type: Date,
    required: true
  },
  device: {
    type: String,
    default: null
  },
  ip: {
    type: String,
    default: null
  }
}, { timestamps: true });

customerSessionSchema.index({ expire: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('CustomerSession', customerSessionSchema);
