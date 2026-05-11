import mongoose from 'mongoose';

const multilingualStringSchema = new mongoose.Schema({
  ru: { type: String, default: '' },
  en: { type: String, default: '' }
}, { _id: false });

const stepSchema = new mongoose.Schema({
  order: { type: Number, required: true },
  label: { type: multilingualStringSchema, required: true },
  description: { type: multilingualStringSchema },
  fieldType: {
    type: String,
    enum: ['text', 'textarea', 'number', 'select', 'file', 'email', 'phone'],
    required: true
  },
  options: [{ type: multilingualStringSchema }],
  required: { type: Boolean, default: true },
  maxFiles: { type: Number, default: 5 }
}, { _id: true });

const scenarioSchema = new mongoose.Schema({
  title: { type: multilingualStringSchema, required: true },
  description: { type: multilingualStringSchema },
  steps: [stepSchema]
}, { timestamps: true });

export default mongoose.model('Scenario', scenarioSchema);
