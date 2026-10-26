import mongoose from 'mongoose';
import BlogPost from '../models/BlogPost.js';
import BlogReaction, { REACTION_TYPES } from '../models/BlogReaction.js';
import BlogView from '../models/BlogView.js';
import { bunnyUpload, generateFilename, getBunnyPublicUrl } from '../utils/bunnyStorage.js';
import { deleteAnyFile, extractImageUrls } from '../utils/deleteFile.js';
import { buildSafeRegex } from '../utils/safeQuery.js';
import { importFromTeletype, TeletypeImportError } from '../services/blog/teletypeImport.js';

const PUBLIC_LITE_FIELDS = '-html -metaTitle -metaDescription -authorName -noindex -__v';

// Decorates a list of posts with `translations`: the other-language sibling(s)
// sharing the same translationGroupId, so the UI can show "RU + EN" coverage.
const attachTranslations = async (items) => {
  // flattenMaps: true — without it, Document#toObject() leaves `reactions` (a Mongoose Map)
  // as a real Map instance. JSON.stringify() (which res.json() uses) serializes a bare Map
  // to "{}", so every reaction count silently disappeared on any endpoint routed through
  // this helper (admin list + admin get-by-id), even though it saved/counted correctly.
  const toPlain = (p) => p.toObject({ flattenMaps: true });

  const groupIds = [...new Set(items.map((p) => p.translationGroupId).filter(Boolean))];
  if (!groupIds.length) return items.map((p) => ({ ...toPlain(p), translations: [] }));

  const siblings = await BlogPost.find({ translationGroupId: { $in: groupIds } })
    .select('_id lang slug title status translationGroupId');

  const byGroup = new Map();
  for (const s of siblings) {
    const list = byGroup.get(s.translationGroupId) || [];
    list.push(s);
    byGroup.set(s.translationGroupId, list);
  }

  return items.map((p) => {
    const plain = p.toObject ? toPlain(p) : p;
    const group = plain.translationGroupId ? (byGroup.get(plain.translationGroupId) || []) : [];
    plain.translations = group
      .filter((s) => String(s._id) !== String(plain._id))
      .map((s) => ({ _id: s._id, lang: s.lang, slug: s.slug, title: s.title, status: s.status }));
    return plain;
  });
};

const stripHtml = (html = '') => String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const countWords = (html = '') => {
  const text = stripHtml(html);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
};

const slugify = (value = '') => String(value)
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9\s-]/g, '')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 120);

const uploadCover = async (file) => {
  const filename = generateFilename(file.originalname);
  const remotePath = `/blog/${filename}`;
  await bunnyUpload(remotePath, file.buffer, file.mimetype);
  return getBunnyPublicUrl(remotePath);
};

const computeDerived = (html) => {
  const wordCount = countWords(html);
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 200));
  return { wordCount, readingMinutes };
};

const resolvePublishedAt = (status, publishedAt) => {
  if (status === 'draft') return null;
  if (publishedAt) return new Date(publishedAt);
  return new Date();
};

/* ===================== Admin CRUD ===================== */

export const adminListBlogPosts = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', lang, status, tag, unlinked } = req.query;
    const query = {};
    if (lang) query.lang = lang;
    if (status) query.status = status;
    if (tag) query.tag_ids = tag;
    // Used by the editor's "link translation" picker — posts that aren't part of a pair yet.
    if (unlinked === 'true') query.translationGroupId = null;
    const safeSearch = buildSafeRegex(search);
    if (safeSearch) {
      query.$or = [{ title: safeSearch }, { slug: safeSearch }];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [rawItems, total] = await Promise.all([
      BlogPost.find(query).select(PUBLIC_LITE_FIELDS).populate('tag_ids').sort({ pinned: -1, createdAt: -1 }).skip(skip).limit(Number(limit)),
      BlogPost.countDocuments(query)
    ]);
    const items = await attachTranslations(rawItems);

    res.json({ success: true, data: { items, total, page: Number(page), pages: Math.max(1, Math.ceil(total / limit)), pageSize: Number(limit) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching blog posts' });
  }
};

export const adminGetBlogPostById = async (req, res) => {
  try {
    const post = await BlogPost.findById(req.params.id).populate('tag_ids');
    if (!post) return res.status(404).json({ success: false, code: 'BLOG_NOT_FOUND', message: 'Post not found' });
    const [decorated] = await attachTranslations([post]);
    res.json({ success: true, data: { post: decorated } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching blog post' });
  }
};

export const adminCreateBlogPost = async (req, res) => {
  try {
    const body = req.body;
    const lang = body.lang;
    const title = (body.title || '').trim();
    if (!lang || !title) {
      return res.status(400).json({ success: false, message: 'lang и title обязательны' });
    }

    const slug = (body.slug ? slugify(body.slug) : slugify(title)) || `post-${Date.now()}`;
    const existing = await BlogPost.findOne({ lang, slug });
    if (existing) return res.status(409).json({ success: false, message: 'Пост с таким slug уже существует для этого языка' });

    const html = body.html || '';
    const { wordCount, readingMinutes } = computeDerived(html);
    const status = body.status || 'draft';

    const cover = req.file ? await uploadCover(req.file) : (body.cover || null);

    // linkToPostId: creating this post as the translation of an existing one —
    // both end up sharing the same translationGroupId (seeding it on the source if needed).
    let translationGroupId = null;
    if (body.linkToPostId) {
      const source = await BlogPost.findById(body.linkToPostId);
      if (source) {
        translationGroupId = source.translationGroupId || String(source._id);
        if (!source.translationGroupId) {
          source.translationGroupId = translationGroupId;
          await source.save();
        }
      }
    }

    const post = await BlogPost.create({
      lang,
      slug,
      title,
      excerpt: body.excerpt || '',
      cover,
      tag_ids: parseTagIds(body.tag_ids),
      html,
      authorName: body.authorName || '',
      metaTitle: body.metaTitle || '',
      metaDescription: body.metaDescription || '',
      metaKeywords: body.metaKeywords || '',
      translationGroupId,
      noindex: body.noindex === 'true' || body.noindex === true,
      pinned: body.pinned === 'true' || body.pinned === true,
      status,
      publishedAt: resolvePublishedAt(status, body.publishedAt),
      wordCount,
      readingMinutes
    });

    if (!post.translationGroupId) {
      post.translationGroupId = String(post._id);
      await post.save();
    }
    await post.populate('tag_ids');

    res.status(201).json({ success: true, data: { post } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Error creating blog post' });
  }
};

export const adminUpdateBlogPost = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await BlogPost.findById(id);
    if (!existing) return res.status(404).json({ success: false, code: 'BLOG_NOT_FOUND', message: 'Post not found' });

    const body = req.body;
    const update = {};

    if (body.title !== undefined) update.title = body.title.trim();
    if (body.slug !== undefined && body.slug.trim()) {
      const newSlug = slugify(body.slug);
      if (newSlug !== existing.slug) {
        const dupe = await BlogPost.findOne({ lang: existing.lang, slug: newSlug, _id: { $ne: id } });
        if (dupe) return res.status(409).json({ success: false, message: 'Пост с таким slug уже существует для этого языка' });
        update.slug = newSlug;
      }
    }
    if (body.excerpt !== undefined) update.excerpt = body.excerpt;
    if (body.authorName !== undefined) update.authorName = body.authorName;
    if (body.metaTitle !== undefined) update.metaTitle = body.metaTitle;
    if (body.metaDescription !== undefined) update.metaDescription = body.metaDescription;
    if (body.metaKeywords !== undefined) update.metaKeywords = body.metaKeywords;
    if (body.noindex !== undefined) update.noindex = body.noindex === 'true' || body.noindex === true;
    if (body.pinned !== undefined) update.pinned = body.pinned === 'true' || body.pinned === true;
    if (body.tag_ids !== undefined) update.tag_ids = parseTagIds(body.tag_ids);

    if (body.linkToPostId) {
      const source = await BlogPost.findById(body.linkToPostId);
      if (source) {
        const groupId = source.translationGroupId || String(source._id);
        if (!source.translationGroupId) {
          source.translationGroupId = groupId;
          await source.save();
        }
        update.translationGroupId = groupId;
      }
    } else if (body.unlinkTranslation === 'true') {
      update.translationGroupId = String(existing._id);
    }

    if (body.html !== undefined) {
      update.html = body.html;
      const { wordCount, readingMinutes } = computeDerived(body.html);
      update.wordCount = wordCount;
      update.readingMinutes = readingMinutes;

      const oldUrls = extractImageUrls(existing.html || '', 'blog');
      const newUrls = new Set(extractImageUrls(body.html || '', 'blog'));
      for (const url of oldUrls) {
        if (!newUrls.has(url)) deleteAnyFile(url);
      }
    }

    const removeCover = body.removeCover === 'true' && !req.file;
    if (req.file) {
      if (existing.cover) deleteAnyFile(existing.cover);
      update.cover = await uploadCover(req.file);
    } else if (removeCover) {
      if (existing.cover) deleteAnyFile(existing.cover);
      update.cover = null;
    } else if (body.cover && body.cover !== existing.cover) {
      // Already-hosted URL (e.g. from the Teletype import) instead of an uploaded file.
      if (existing.cover) deleteAnyFile(existing.cover);
      update.cover = body.cover;
    }

    const status = body.status !== undefined ? body.status : existing.status;
    if (body.status !== undefined || body.publishedAt !== undefined) {
      update.status = status;
      update.publishedAt = resolvePublishedAt(status, body.publishedAt !== undefined ? body.publishedAt : existing.publishedAt);
    }

    const post = await BlogPost.findByIdAndUpdate(id, update, { new: true }).populate('tag_ids');
    res.json({ success: true, data: { post } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Error updating blog post' });
  }
};

export const adminDeleteBlogPost = async (req, res) => {
  try {
    const post = await BlogPost.findByIdAndDelete(req.params.id);
    if (post) {
      if (post.cover) deleteAnyFile(post.cover);
      for (const url of extractImageUrls(post.html || '', 'blog')) deleteAnyFile(url);
    }
    res.json({ success: true, data: { message: 'Blog post deleted' } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting blog post' });
  }
};

export const adminUploadBlogImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });
    const url = await uploadCover(req.file);
    res.json({ success: true, data: { url } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error uploading image' });
  }
};

// Parses an already-published teletype.in article into a draft (title/excerpt/html/cover,
// images re-hosted on our own storage) — doesn't touch the DB, the admin reviews/edits
// it in the editor and saves through the normal create/update endpoints.
export const adminImportFromTeletype = async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'url обязателен' });
    const draft = await importFromTeletype(url);
    res.json({ success: true, data: draft });
  } catch (error) {
    if (error instanceof TeletypeImportError) {
      return res.status(422).json({ success: false, message: error.message });
    }
    console.error(error);
    res.status(500).json({ success: false, message: 'Ошибка импорта статьи' });
  }
};

function parseTagIds(raw) {
  if (raw === undefined) return [];
  let list = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try { list = JSON.parse(s); } catch { list = s.split(','); }
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((t) => String(t).trim()).filter((id) => mongoose.isValidObjectId(id)))].slice(0, 20);
}

/* ===================== Public API ===================== */

export const publicListBlogPosts = async (req, res) => {
  try {
    const { lang } = req.params;
    const { page = 1, limit = 13, tag } = req.query;
    const query = { lang, status: 'published', publishedAt: { $lte: new Date() } };
    if (tag) query.tag_ids = tag;

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      BlogPost.find(query).select(PUBLIC_LITE_FIELDS).populate('tag_ids').sort({ pinned: -1, publishedAt: -1 }).skip(skip).limit(Number(limit)),
      BlogPost.countDocuments(query)
    ]);

    res.json({ success: true, data: { items, total, page: Number(page), pages: Math.max(1, Math.ceil(total / limit)), pageSize: Number(limit) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching blog posts' });
  }
};

export const publicGetBlogPostBySlug = async (req, res) => {
  try {
    const { lang, slug } = req.params;
    const { visitorId } = req.query;
    const publishedFilter = { status: 'published', publishedAt: { $lte: new Date() } };
    const post = await BlogPost.findOne({ lang, slug, ...publishedFilter }).populate('tag_ids');
    if (!post) return res.status(404).json({ success: false, code: 'BLOG_NOT_FOUND', message: 'Post not found' });

    const [related, recent, translationSibling, myReaction] = await Promise.all([
      post.tag_ids?.length
        ? BlogPost.find({ lang, _id: { $ne: post._id }, tag_ids: { $in: post.tag_ids }, ...publishedFilter })
          .select(PUBLIC_LITE_FIELDS).populate('tag_ids').sort({ publishedAt: -1 }).limit(3)
        : [],
      BlogPost.find({ lang, _id: { $ne: post._id }, ...publishedFilter })
        .select(PUBLIC_LITE_FIELDS).populate('tag_ids').sort({ publishedAt: -1 }).limit(3),
      post.translationGroupId
        ? BlogPost.findOne({ translationGroupId: post.translationGroupId, _id: { $ne: post._id }, ...publishedFilter })
          .select('lang slug title')
        : null,
      visitorId ? BlogReaction.findOne({ postId: post._id, visitorId }).select('type') : null
    ]);

    res.json({
      success: true,
      data: {
        post,
        related,
        recent,
        translation: translationSibling || null,
        myReaction: myReaction?.type || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching blog post' });
  }
};

export const publicRegisterBlogView = async (req, res) => {
  try {
    const { lang, slug } = req.params;
    const { visitorId } = req.body;
    const post = await BlogPost.findOne({ lang, slug, status: 'published', publishedAt: { $lte: new Date() } }).select('_id views');
    if (!post) return res.status(404).json({ success: false, code: 'BLOG_NOT_FOUND', message: 'Post not found' });

    if (visitorId) {
      const day = new Date().toISOString().slice(0, 10);
      try {
        await BlogView.create({ postId: post._id, visitorId, day });
        post.views += 1;
        await post.save();
      } catch (error) {
        // Duplicate key = already counted today for this visitor — not an error, just a no-op.
        if (error?.code !== 11000) throw error;
      }
    }

    res.json({ success: true, data: { views: post.views } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error registering view' });
  }
};

export const publicReactToBlogPost = async (req, res) => {
  try {
    const { lang, slug } = req.params;
    const { visitorId, type } = req.body;
    if (!visitorId || !REACTION_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid reaction' });
    }

    const post = await BlogPost.findOne({ lang, slug, status: 'published', publishedAt: { $lte: new Date() } });
    if (!post) return res.status(404).json({ success: false, code: 'BLOG_NOT_FOUND', message: 'Post not found' });

    const existing = await BlogReaction.findOne({ postId: post._id, visitorId });
    let myReaction = type;

    if (existing && existing.type === type) {
      // Clicking the same reaction again removes it.
      await existing.deleteOne();
      post.reactions.set(type, Math.max(0, (post.reactions.get(type) || 0) - 1));
      myReaction = null;
    } else if (existing) {
      post.reactions.set(existing.type, Math.max(0, (post.reactions.get(existing.type) || 0) - 1));
      post.reactions.set(type, (post.reactions.get(type) || 0) + 1);
      existing.type = type;
      await existing.save();
    } else {
      await BlogReaction.create({ postId: post._id, visitorId, type });
      post.reactions.set(type, (post.reactions.get(type) || 0) + 1);
    }

    await post.save();
    res.json({ success: true, data: { reactions: Object.fromEntries(post.reactions), myReaction } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error saving reaction' });
  }
};

export const publicGetBlogRss = async (req, res) => {
  try {
    const { lang } = req.params;
    const siteUrl = (process.env.SITE_URL || 'https://banana-traff-shop.com').replace(/\/$/, '');
    const siteName = process.env.SITE_NAME || 'Banana Traff Shop';

    const posts = await BlogPost.find({ lang, status: 'published', noindex: false, publishedAt: { $lte: new Date() } })
      .select('title excerpt slug publishedAt updatedAt')
      .sort({ publishedAt: -1 })
      .limit(50);

    const escapeXml = (s = '') => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    const items = posts.map((p) => {
      const link = `${siteUrl}/${lang}/blog/${p.slug}`;
      return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>
      <description>${escapeXml(p.excerpt)}</description>
    </item>`;
    }).join('\n');

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteName)} Blog</title>
    <link>${siteUrl}/${lang}/blog</link>
    <description>${escapeXml(siteName)} Blog</description>
    <language>${lang}</language>
    <atom:link href="${siteUrl}/api/v2/blog/${lang}/rss.xml" rel="self" type="application/rss+xml" />
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(rss);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error generating RSS feed' });
  }
};

export const publicGetBlogSitemapEntries = async (req, res) => {
  try {
    const siteUrl = (process.env.SITE_URL || 'https://banana-traff-shop.com').replace(/\/$/, '');
    const posts = await BlogPost.find({ status: 'published', noindex: false, publishedAt: { $lte: new Date() } })
      .select('lang slug updatedAt')
      .sort({ publishedAt: -1 });

    const urls = [
      ...['ru', 'en'].map((lang) => ({
        loc: `${siteUrl}/${lang}/blog`,
        changefreq: 'weekly',
        priority: '0.7'
      })),
      ...posts.map((p) => ({
        loc: `${siteUrl}/${p.lang}/blog/${p.slug}`,
        lastmod: p.updatedAt?.toISOString().slice(0, 10),
        changefreq: 'monthly',
        priority: '0.6'
      }))
    ];

    res.json({ success: true, data: { urls } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching sitemap entries' });
  }
};
