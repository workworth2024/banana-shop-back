import mongoose from 'mongoose';
import crypto from 'crypto';

// One condition = one filter row in the segment builder UI. `operator` is only
// used for numeric fields (gt/gte/lt/lte/eq); date fields use value/valueTo as
// a from/to range; boolean/select fields just use value; text fields ('contains').
const conditionSchema = new mongoose.Schema({
  field: { type: String, required: true },
  operator: { type: String, default: null },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  valueTo: { type: mongoose.Schema.Types.Mixed, default: null }
}, { _id: false });

const segmentSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
    default: () => 'SEG-' + crypto.randomBytes(4).toString('hex').toUpperCase()
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 150
  },
  conditions: {
    type: [conditionSchema],
    default: []
  },
  // Cached from the last time it was computed (on create/update, or via the
  // "refresh" action) so the history table doesn't have to run the full
  // aggregation just to render a list.
  memberCount: {
    type: Number,
    default: 0
  },
  computedAt: {
    type: Date,
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, { timestamps: true });

export default mongoose.model('Segment', segmentSchema);
