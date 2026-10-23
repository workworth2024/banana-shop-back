/**
 * Landing-page audit for PPC Helper: title, description, headings, CTAs and visible text that the
 * keyword engine uses to ground the semantic core. Ported from keyword-engine-v2-new/server/site-audit.ts,
 * but the fetch goes through the SSRF-guarded safeFetch (address pinned at connect time, every redirect hop re-checked,
 * private / link-local / metadata ranges blocked, size cap) instead of a plain fetch with redirect: 'follow'.
 * The Banana Traff catalogue is read from our own DB instead of an HTTP call with a token.
 */
import { safeFetch as fetchPublic } from './safeFetch.js';
import { renderPage } from '../siteAnalyzer/renderer.js';
import GoogleAdsProduct from '../../models/GoogleAdsProduct.js';
import Service from '../../models/Service.js';

const RENDER_SPA = process.env.PPC_RENDER_SPA === '1';

const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const THIN_TEXT = 300;
const OWN_HOSTS = /(^|\.)banana-traff-shop\.com$/i;

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; });
}

function stripTags(value) {
  return decodeEntities(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const matches = (html, pattern) => Array.from(html.matchAll(pattern)).map((m) => stripTags(m[1] || '')).filter(Boolean);
const unique = (items) => Array.from(new Set(items.map((i) => i.trim()).filter(Boolean)));

export const emptyAudit = (requestedUrl = '', status = 'missing_url', error) => ({
  requestedUrl,
  checked: false,
  status,
  error,
  title: '',
  description: '',
  h1: [],
  headings: [],
  ctas: [],
  visibleText: '',
  contentPhrases: [],
  detectedLinks: []
});

async function ownCatalog() {
  const pick = (v) => (v && typeof v === 'object' ? v.ru || v.en || '' : v || '');
  try {
    const [products, services] = await Promise.all([
      GoogleAdsProduct.find({}).select('title desc geos price type').limit(100).lean(),
      Service.find({}).select('title desc price').limit(100).lean()
    ]);
    const items = [...products, ...services].map((row) => ({
      title: stripTags(pick(row.title)).slice(0, 200),
      description: stripTags(pick(row.desc)).slice(0, 1600),
      type: row.type,
      geos: Array.isArray(row.geos) ? row.geos.map((g) => (typeof g === 'string' ? g : g?.code)).filter(Boolean) : [],
      price: Number(row.price) || undefined
    })).filter((i) => i.title);
    return { items: items.slice(0, 120), text: items.map((i) => `${i.title}. ${i.description}`).join(' ').slice(0, 18000) };
  } catch (e) {
    console.warn('[PpcHelper] catalog read failed:', e.message);
    return { items: [], text: '' };
  }
}

export function parseHtml(html) {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 300);
  const description = decodeEntities(
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i)?.[1]
    || ''
  ).slice(0, 500);
  const h1 = matches(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map((s) => s.slice(0, 200)).slice(0, 8);
  const headings = matches(html, /<h[2-3][^>]*>([\s\S]*?)<\/h[2-3]>/gi).map((s) => s.slice(0, 200)).slice(0, 24);
  const ctas = matches(html, /<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)
    .filter((i) => i.length <= 80 && /куп|заказ|рег|получ|начать|узнать|подключ|войти|buy|order|sign|start|get|learn|contact|в корзину|подробнее|kaufen|comprar|zamów/i.test(i))
    .slice(0, 30);
  const detectedLinks = Array.from(html.matchAll(/href=["'](https?:\/\/[^"']+|\/[^"']*)["']/gi)).map((m) => m[1].slice(0, 300)).slice(0, 50);
  const visibleText = stripTags(html).slice(0, 12000);
  return { title, description, h1, headings, ctas, detectedLinks, visibleText };
}

/** Never throws: an unreachable page comes back as { checked: false, status, error } with a neutral RU message. */
export async function auditLandingPage(rawUrl) {
  const requestedUrl = String(rawUrl || '').trim();
  if (!requestedUrl) return emptyAudit('', 'missing_url');
  try {
    const page = await fetchPublic(requestedUrl, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_HTML_BYTES });
    const isHtml = /html|xml|^$/i.test(String(page.headers['content-type'] || ''));
    let parsed = parseHtml(isHtml ? page.body : '');
    // SPA shells have no text in the raw HTML — render once, like the Site Analyzer does
    // Chrome resolves and follows JS/meta redirects on its own, outside the SSRF guard — opt-in only
    if (RENDER_SPA && page.status < 400 && isHtml && parsed.visibleText.length < THIN_TEXT) {
      const rendered = await renderPage(page.finalUrl);
      if (rendered?.html) {
        const r = parseHtml(String(rendered.html).slice(0, MAX_HTML_BYTES));
        if (r.visibleText.length > parsed.visibleText.length) parsed = r;
      }
    }
    const host = new URL(page.finalUrl).hostname;
    const catalog = OWN_HOSTS.test(host) ? await ownCatalog() : { items: [], text: '' };
    // CTA labels ("Learn more", "Sign up") describe buttons, not the product — they stay in `ctas` for the AI only
    const contentPhrases = unique([...parsed.h1, ...parsed.headings, ...catalog.items.flatMap((i) => [i.title, ...i.title.split(/[|•—–,;/]+/)])]).slice(0, 160);
    const ok = page.status >= 200 && page.status < 400;
    return {
      requestedUrl,
      finalUrl: page.finalUrl,
      checked: ok && (parsed.visibleText.length > 0 || catalog.items.length > 0),
      status: ok ? 'ok' : `http_${page.status}`,
      httpStatus: page.status,
      ...parsed,
      contentPhrases,
      catalogItems: catalog.items,
      catalogText: catalog.text,
      error: ok ? undefined : `сайт вернул HTTP ${page.status}`
    };
  } catch (error) {
    const blocked = error?.constructor?.name === 'BlockedHostError';
    const timeout = error?.name === 'AbortError';
    console.warn('[PpcHelper] audit fetch failed:', requestedUrl, error?.message, error?.cause?.code || '');
    return emptyAudit(requestedUrl, blocked ? 'blocked' : 'fetch_error',
      blocked ? 'адрес недоступен для проверки' : timeout ? 'сайт не ответил вовремя' : 'не удалось открыть страницу');
  }
}
