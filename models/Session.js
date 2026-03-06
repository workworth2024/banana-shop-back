import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
    required: false
  },
  ip: {
    type: String,
    required: false
  }
}, { timestamps: true });

export default mongoose.model('Session', sessionSchema);
