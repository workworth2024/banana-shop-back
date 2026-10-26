// Imports an already-published Teletype article into our own blog format: pulls the
// article HTML, keeps the formatting our editor understands (headings/paragraphs/lists/
// links/bold/italic/images), re-hosts every image on our own storage (never hotlinks
// teletype.in), and hands back a draft the admin reviews/edits before saving as usual.
import * as cheerio from 'cheerio';
import { safeFetch, safeFetchBuffer } from '../ppcHelper/safeFetch.js';
import { bunnyUpload, generateFilename, getBunnyPublicUrl } from '../../utils/bunnyStorage.js';

const ALLOWED_HOSTS = /(^|\.)teletype\.in$/i;
const MAX_IMAGES = 30;

export class TeletypeImportError extends Error {}

const assertTeletypeUrl = (raw) => {
  let url;
  try { url = new URL(raw); } catch { throw new TeletypeImportError('Некорректная ссылка'); }
  if (!/^https?:$/.test(url.protocol) || !ALLOWED_HOSTS.test(url.hostname)) {
    throw new TeletypeImportError('Поддерживаются только ссылки на teletype.in');
  }
  return url;
};

const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

const imageCache = new Map();

async function rehostImage(src) {
  if (!src) return null;
  if (imageCache.has(src)) return imageCache.get(src);
  try {
    const abs = new URL(src, 'https://teletype.in').toString();
    assertTeletypeUrl(abs); // only re-host images actually served from teletype's own CDN
    const res = await safeFetchBuffer(abs);
    if (res.status !== 200 || !res.buffer?.length) return null;
    const mime = String(res.headers['content-type'] || '').split(';')[0].trim() || 'image/jpeg';
    const ext = EXT_BY_MIME[mime] || 'jpg';
    const filename = generateFilename(`teletype.${ext}`);
    const remotePath = `/blog/${filename}`;
    await bunnyUpload(remotePath, res.buffer, mime);
    const url = getBunnyPublicUrl(remotePath);
    imageCache.set(src, url);
    return url;
  } catch {
    return null;
  }
}

const escapeHtml = (s = '') => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Renders inline formatting (bold/italic/links/line breaks/plain text) inside a block element.
async function renderInline($, node) {
  const $node = $(node);
  let out = '';
  for (const child of $node.contents().toArray()) {
    if (child.type === 'text') {
      out += escapeHtml(child.data);
    } else if (child.type === 'tag') {
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') { out += '<br>'; continue; }
      if (['strong', 'b'].includes(tag)) { out += `<strong>${await renderInline($, child)}</strong>`; continue; }
      if (['em', 'i'].includes(tag)) { out += `<em>${await renderInline($, child)}</em>`; continue; }
      if (tag === 'u') { out += `<u>${await renderInline($, child)}</u>`; continue; }
      if (tag === 'a' && $(child).attr('href')) {
        const href = $(child).attr('href');
        const external = /^https?:\/\//i.test(href) && !ALLOWED_HOSTS.test((() => { try { return new URL(href).hostname; } catch { return ''; } })());
        out += `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${await renderInline($, child)}</a>`;
        continue;
      }
      // Unknown inline wrapper (teletype's anchor spans etc.) — keep its text, drop the tag.
      out += await renderInline($, child);
    }
  }
  return out;
}

// Walks a container's child nodes and rebuilds them as plain, sanitized HTML — nothing
// from teletype's own markup (Vue comments, data-* attrs, classes, inline styles) survives.
// `allowCover` is only true for the article's own top level — Teletype's colored "callout"
// boxes (promo codes, CTAs) are <section> wrappers; their images must stay inline, not get
// promoted to the article cover.
async function collectBlocks($, container, { allowCover }) {
  const blocks = [];
  let coverUrl = null;
  let imageCount = 0;

  for (const node of $(container).contents().toArray()) {
    if (node.type !== 'tag') continue;
    const tag = node.tagName.toLowerCase();
    const $n = $(node);

    if (['h2', 'h3', 'h4'].includes(tag)) {
      const text = (await renderInline($, node)).trim();
      if (text) blocks.push(`<${tag}>${text}</${tag}>`);
      continue;
    }

    if (tag === 'p') {
      const text = (await renderInline($, node)).trim();
      if (text) blocks.push(`<p>${text}</p>`);
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      const items = [];
      for (const li of $n.find('> li').toArray()) {
        const text = (await renderInline($, li)).trim();
        if (text) items.push(`<li>${text}</li>`);
      }
      if (items.length) blocks.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    if (tag === 'blockquote') {
      const text = (await renderInline($, node)).trim();
      if (text) blocks.push(`<blockquote>${text}</blockquote>`);
      continue;
    }

    if (tag === 'figure') {
      // Teletype lazy-loads images — the real URL only shows up in the <noscript> fallback.
      const src = $n.find('noscript img').attr('src') || $n.find('img').attr('src');
      if (!src || imageCount >= MAX_IMAGES) continue;
      const hosted = await rehostImage(src);
      if (!hosted) continue;
      if (allowCover && !coverUrl) {
        // First image at the top level becomes the suggested cover instead of inline
        // content, matching how our own editor separates cover vs. body.
        coverUrl = hosted;
        continue;
      }
      imageCount += 1;
      const caption = $n.find('figcaption').text().trim();
      blocks.push(`<p><img src="${escapeHtml(hosted)}" alt="${escapeHtml(caption)}"></p>`);
      continue;
    }

    if (tag === 'section') {
      // Colored callout boxes (promo codes, CTAs) — keep the content, drop teletype's inline
      // background-color styling, wrap in our own callout class instead. Emitted as a
      // data-raw-html-block (the same format our editor's "insert custom HTML" button
      // produces) so the admin's TipTap editor round-trips it as a single block instead of
      // stripping the unrecognized <div class="blog-callout"> wrapper down to plain text.
      const inner = await collectBlocks($, node, { allowCover: false });
      if (inner.blocks.length) blocks.push(`<div data-raw-html-block><div class="blog-callout">${inner.blocks.join('')}</div></div>`);
      continue;
    }

    // Anything else (embeds, dividers, etc.) — skip rather than leak raw/unsafe markup.
  }

  return { blocks, coverUrl };
}

async function renderBlocks($, root) {
  const { blocks, coverUrl } = await collectBlocks($, root, { allowCover: true });
  return { html: blocks.join(''), coverUrl };
}

export async function importFromTeletype(rawUrl) {
  const url = assertTeletypeUrl(rawUrl);
  const res = await safeFetch(url.toString(), { maxBytes: 4 * 1024 * 1024 });
  if (res.status !== 200 || !res.body) {
    throw new TeletypeImportError('Не удалось загрузить страницу Teletype');
  }

  // scriptingEnabled:false makes <noscript> content parse as real child nodes instead of
  // raw text — that's where teletype puts each image's actual URL (everything else is lazy-loaded via JS).
  const $ = cheerio.load(res.body, { scriptingEnabled: false });
  const title = $('h1').first().text().trim() || $('title').text().replace(/\s*—\s*Teletype\s*$/i, '').trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';
  const article = $('.article__content, article').first();
  if (!article.length) throw new TeletypeImportError('Не удалось найти текст статьи на странице');

  const { html, coverUrl } = await renderBlocks($, article.get(0));
  if (!html) throw new TeletypeImportError('Статья пуста или имеет неподдерживаемый формат');

  const excerptSource = metaDescription || $(article).find('p').first().text().trim();
  const excerpt = excerptSource.length > 240 ? `${excerptSource.slice(0, 237)}...` : excerptSource;

  return { title, excerpt, metaDescription, cover: coverUrl, html, sourceUrl: url.toString() };
}
