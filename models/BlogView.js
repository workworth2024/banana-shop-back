import mongoose from 'mongoose';

const blogViewSchema = new mongoose.Schema({
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BlogPost',
    required: true
  },
  visitorId: {
    type: String,
    required: true
  },
  // UTC day bucket (YYYY-MM-DD) — one counted view per visitor per post per day,
  // so refreshing the page doesn't inflate the counter.
  day: {
    type: String,
    required: true
  }
}, { timestamps: true });

blogViewSchema.index({ postId: 1, visitorId: 1, day: 1 }, { unique: true });

export default mongoose.model('BlogView', blogViewSchema);
