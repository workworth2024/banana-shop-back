import mongoose from 'mongoose';

const SUPPORTED_LANGS = ['ru', 'en'];

const blogPostSchema = new mongoose.Schema({
  lang: {
    type: String,
    enum: SUPPORTED_LANGS,
    required: true
  },
  slug: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  excerpt: {
    type: String,
    default: '',
    trim: true
  },
  cover: {
    type: String,
    default: null
  },
  tag_ids: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BlogTag' }],
    default: []
  },
  html: {
    type: String,
    default: ''
  },
  authorName: {
    type: String,
    default: '',
    trim: true
  },
  metaTitle: {
    type: String,
    default: '',
    trim: true
  },
  metaDescription: {
    type: String,
    default: '',
    trim: true
  },
  metaKeywords: {
    type: String,
    default: '',
    trim: true
  },
  // Links a post to its translation(s): posts sharing the same value are the ru/en
  // pair of one article. Defaults to the post's own _id right after creation (see
  // controller), so "linking" a second language just means copying this value over.
  translationGroupId: {
    type: String,
    default: null,
    index: true
  },
  views: {
    type: Number,
    default: 0
  },
  reactions: {
    type: Map,
    of: Number,
    default: {}
  },
  noindex: {
    type: Boolean,
    default: false
  },
  pinned: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'scheduled'],
    default: 'draft'
  },
  publishedAt: {
    type: Date,
    default: null
  },
  readingMinutes: {
    type: Number,
    default: 1
  },
  wordCount: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

blogPostSchema.index({ lang: 1, slug: 1 }, { unique: true });
blogPostSchema.index({ lang: 1, status: 1, publishedAt: -1 });

export default mongoose.model('BlogPost', blogPostSchema);
