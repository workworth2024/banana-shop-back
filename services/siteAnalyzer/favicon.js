/**
 * The site's own favicon, inlined as a data: URI so the report (and the guest history kept in
 * localStorage) shows it without hotlinking the site from the user's browser. Google's favicon
 * service only knows sites it has crawled — brand-new domains get a generic globe there.
 */
import { fetchPublic } from './htmlFetcher.js';

const MAX_ICON_BYTES = 48 * 1024;
const TIMEOUT_MS = 6000;
const TYPES = { png: 'image/png', ico: 'image/x-icon', svg: 'image/svg+xml', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1] || '';

function candidates(html, pageUrl) {
  const list = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, 'rel').toLowerCase();
    if (!/\bicon\b|apple-touch-icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const href = attr(tag, 'href');
    if (!href) continue;
    const size = parseInt((attr(tag, 'sizes').match(/(\d+)/) || [])[1] || (rel.includes('apple') ? '180' : '32'), 10);
    // prefer ~32–64px raster or svg; huge apple icons last (heavier)
    const score = /\.svg(\?|$)/i.test(href) || /svg/.test(attr(tag, 'type')) ? 0 : Math.abs(Math.min(size, 192) - 48);
    try { list.push({ url: new URL(href, pageUrl).toString(), score }); } catch { /* bad href */ }
  }
  list.sort((a, b) => a.score - b.score);
  list.push({ url: new URL('/favicon.ico', pageUrl).toString(), score: 999 });
  return [...new Map(list.map((c) => [c.url, c])).values()].slice(0, 4);
}

function sniff(buf, headerType, url) {
  const type = String(headerType || '').split(';')[0].trim().toLowerCase();
  if (type.startsWith('image/')) return type;
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (/^\s*(<\?xml[^>]*>\s*)?<svg\b/i.test(buf.slice(0, 200).toString('utf8'))) return 'image/svg+xml';
  if (url.startsWith('data:')) return null;
  const ext = (url.split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  return TYPES[ext] && type !== 'text/html' ? TYPES[ext] : null;
}

export async function getFavicon(html, pageUrl) {
  for (const { url } of candidates(String(html || ''), pageUrl)) {
    if (url.startsWith('data:image/')) return url.length <= MAX_ICON_BYTES * 1.4 ? url : null;
    try {
      const r = await fetchPublic(url, { timeoutMs: TIMEOUT_MS, maxBytes: MAX_ICON_BYTES + 1, binary: true });
      if (r.status !== 200 || !r.body?.length || r.body.length > MAX_ICON_BYTES) continue;
      const type = sniff(r.body, r.headers['content-type'], url);
      if (!type) continue;
      // SVG could carry scripts — only used inside <img>, where scripts never run
      return `data:${type};base64,${r.body.toString('base64')}`;
    } catch { /* try the next candidate */ }
  }
  return null;
}
