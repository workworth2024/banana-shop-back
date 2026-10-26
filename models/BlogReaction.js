import mongoose from 'mongoose';

export const REACTION_TYPES = ['like', 'love', 'fire', 'clap', 'wow'];

const blogReactionSchema = new mongoose.Schema({
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BlogPost',
    required: true
  },
  // Anonymous id generated client-side (localStorage) — the blog has no login wall,
  // so we can't key reactions off a customer account.
  visitorId: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: REACTION_TYPES,
    required: true
  }
}, { timestamps: true });

// One reaction per visitor per post — re-reacting changes/removes it instead of stacking.
blogReactionSchema.index({ postId: 1, visitorId: 1 }, { unique: true });

export default mongoose.model('BlogReaction', blogReactionSchema);
