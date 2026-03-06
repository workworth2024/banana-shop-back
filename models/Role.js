import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema({
  name: {
    type: String,
    enum: ['manager', 'support', 'admin', 'new'],
    required: true,
    unique: true
  },
  access: {
    type: String,
    enum: ['all', 'support', 'manager', 'nothing'],
    required: true
  }
}, { timestamps: true });

export default mongoose.model('Role', roleSchema);
