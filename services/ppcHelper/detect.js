/**
 * "Fill from site" for the PPC Helper form: reads the landing page once (SSRF-guarded, no rendering, no paid
 * APIs) and suggests the offer name, vertical, GEO, keyword language, seed phrases and a description — the same
 * signals the Site Analyzer uses for its auto-detection (ccTLD, html lang / hreflang, currency, phone codes,
 * weighted vertical vocabulary). Suggestions only: the form applies them when the user agrees.
 */
import { safeFetch as fetchPublic } from './safeFetch.js';
import { detectVertical, detectGeo } from '../siteAnalyzer/detectContext.js';
import { GEO_OPTIONS, LANGUAGE_OPTIONS } from './geoLanguages.js';
import { parseHtml } from './siteAudit.js';

const GEO_BY_CODE = new Map(GEO_OPTIONS.map((g) => [g.code, g]));
const LANGUAGE_CODES = new Set(LANGUAGE_OPTIONS.map((l) => l.code));
// Site Analyzer verticals → PPC Helper verticals
const VERTICAL_MAP = { gambling: 'gambling', nutra: 'nutra', crypto: 'finance', finance: 'finance', ecom: 'ecommerce', software: 'ecommerce', sales: 'ecommerce' };

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const meta = (html, prop) => decode(
  html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i'))?.[1]
  || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'))?.[1]
);

/** "PipeFlow CRM — Sales pipeline for SMB | Home" → "PipeFlow CRM" (site name first, else the shortest title part). */
function offerName(html, title, host) {
  const site = meta(html, 'og:site_name') || meta(html, 'application-name');
  if (site && site.length <= 60) return site;
  const parts = String(title || '').split(/\s+[|—–·•:-]\s+/).map((p) => p.trim()).filter((p) => p.length >= 2 && p.length <= 60);
  const brandish = parts.find((p) => p.toLowerCase().replace(/\s+/g, '').includes(host.split('.')[0].replace(/-/g, '')));
  return brandish || parts.sort((a, b) => a.length - b.length)[0] || '';
}

function pageLanguage(html, geo) {
  const m = (html.match(/<html\b[^>]*\blang\s*=\s*["']?([a-z]{2,3})(?:[-_]([a-z]{2,4}))?/i) || []);
  const base = (m[1] || '').toLowerCase();
  if (!base) return null;
  if (base === 'zh') return /tw|hk|hant/i.test(m[2] || '') ? 'zh-TW' : 'zh-CN';
  const code = base === 'nb' || base === 'nn' ? 'no' : base === 'iw' ? 'he' : base === 'tl' ? 'fil' : base;
  if (!LANGUAGE_CODES.has(code)) return null;
  // an English page on a German site is still a German-market page only if German is spoken there — keep the page's language
  return { value: code, confidence: geo && GEO_BY_CODE.get(geo)?.languageCodes.includes(code) ? 'high' : 'medium' };
}

// headings that share a word with the page title/description — "welcome offers" yes, "e-mail not received" no
function seedPhrases(parsed, context) {
  const ctx = new Set((context.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []));
  const out = [];
  for (const raw of [...parsed.h1, ...parsed.headings]) {
    const p = raw.replace(/[|•"«»“”]/g, ' ').replace(/[.!?:]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const words = p.split(' ');
    if (words.length < 2 || words.length > 6 || p.length > 60 || /\d{3,}|©|&|@|cookie|privacy|menu|login|sign in|e-mail|email/i.test(p)) continue;
    if (!(p.match(/[\p{L}\p{N}]{4,}/gu) || []).some((t) => ctx.has(t))) continue;
    if (!out.includes(p)) out.push(p);
    if (out.length >= 5) break;
  }
  return out;
}

/** Returns { ok, finalUrl, suggestions } or { ok: false, reason } (RU/EN neutral message). Never throws. */
export async function detectFromUrl(url, lang = 'ru') {
  const en = lang === 'en';
  let page;
  try {
    page = await fetchPublic(url, { timeoutMs: 12000, maxBytes: 2 * 1024 * 1024 });
  } catch (e) {
    const blocked = e?.constructor?.name === 'BlockedHostError';
    return { ok: false, reason: blocked ? (en ? "This address can't be checked" : 'Этот адрес нельзя проверить') : (en ? "The page didn't open from our servers" : 'Страница не открылась с наших серверов') };
  }
  if (page.status >= 400) return { ok: false, reason: en ? `The site responded with HTTP ${page.status}` : `Сайт ответил HTTP ${page.status}` };
  const html = String(page.body || '');
  const parsed = parseHtml(html);
  const host = new URL(page.finalUrl).hostname.replace(/^www\./, '');

  const v = detectVertical({ text: parsed.visibleText, title: parsed.title, description: parsed.description });
  const vertical = VERTICAL_MAP[v.value] ? { value: VERTICAL_MAP[v.value], confidence: v.confidence, evidence: v.evidence } : null;
  const g = detectGeo({ hostname: host, html, text: parsed.visibleText, headers: page.headers });
  const geo = g.value && GEO_BY_CODE.has(g.value) ? { value: g.value, confidence: g.confidence, evidence: g.evidence } : null;
  let language = pageLanguage(html, geo?.value);
  if (!language && geo) language = { value: GEO_BY_CODE.get(geo.value).languageCodes.find((c) => LANGUAGE_CODES.has(c)), confidence: 'low' };
  const title = offerName(html, parsed.title, host);
  const description = (meta(html, 'og:description') || parsed.description || '').slice(0, 400);
  const thin = parsed.visibleText.length < 200;

  return {
    ok: true,
    finalUrl: page.finalUrl,
    thin, // JS-built page: the build will render it, but the form can only see the shell
    suggestions: {
      title: title ? { value: title.slice(0, 120) } : null,
      vertical,
      geo,
      language: language?.value ? language : null,
      keywords: seedPhrases(parsed, `${parsed.title} ${description} ${title}`),
      description: description.length >= 40 ? { value: description } : null
    }
  };
}
