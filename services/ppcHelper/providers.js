/**
 * Server-side adapters for PPC Helper (ported from keyword-engine-v2-new/server/providers.ts):
 *   - Google Ads keyword metrics (DataForSEO: DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD, or a ready DATAFORSEO_AUTH)
 *   - exact-locale paid SERP (iSearchFrom, ISEARCHFROM_API_KEY)
 * Credentials never leave this file; callers get neutral statuses, raw provider errors go to logs only.
 */
import https from 'node:https';

const METRICS_TIMEOUT_MS = 30000;
const SERP_REQUEST_TIMEOUT_MS = 20000;
const SERP_POLL_DEADLINE_MS = 60000;
const SERP_POLL_INTERVAL_MS = 2500;
export const METRICS_MAX_KEYWORDS = 700;

// DataForSEO occasionally resolves to an unreachable IPv6 route — force IPv4 for this call only.
function postJsonIpv4(url, headers, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);
    const request = https.request({
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      family: 4,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() },
      timeout: timeoutMs
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        data += chunk;
        if (data.length > 20 * 1024 * 1024) request.destroy(new Error('metrics response too large'));
      });
      response.on('end', () => {
        let json = {};
        try { json = JSON.parse(data || '{}'); } catch { json = {}; }
        const status = response.statusCode || 500;
        resolve({ ok: status >= 200 && status < 300, status, json });
      });
    });
    request.on('timeout', () => request.destroy(new Error(`metrics request timed out after ${timeoutMs}ms`)));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

// Google Ads geo target IDs for countries are 2000 + ISO 3166-1 numeric code.
const ISO_NUMERIC = {
  AF: 4, AL: 8, DZ: 12, AR: 32, AM: 51, AU: 36, AT: 40, AZ: 31, BH: 48, BD: 50, BY: 112, BE: 56, BO: 68, BA: 70,
  BR: 76, BG: 100, KH: 116, CA: 124, CL: 152, CN: 156, CO: 170, CR: 188, HR: 191, CY: 196, CZ: 203, DK: 208,
  DO: 214, EC: 218, EG: 818, EE: 233, FI: 246, FR: 250, GE: 268, DE: 276, GH: 288, GR: 300, GT: 320, HN: 340,
  HK: 344, HU: 348, IS: 352, IN: 356, ID: 360, IE: 372, IL: 376, IT: 380, JP: 392, JO: 400, KZ: 398, KE: 404,
  KR: 410, KW: 414, KG: 417, LV: 428, LB: 422, LT: 440, LU: 442, MY: 458, MT: 470, MX: 484, MD: 498, MN: 496,
  MA: 504, NP: 524, NL: 528, NZ: 554, NI: 558, NG: 566, NO: 578, OM: 512, PK: 586, PA: 591, PY: 600, PE: 604,
  PH: 608, PL: 616, PT: 620, QA: 634, RO: 642, RU: 643, SA: 682, RS: 688, SG: 702, SK: 703, SI: 705, ZA: 710,
  ES: 724, LK: 144, SE: 752, CH: 756, TW: 158, TJ: 762, TH: 764, TN: 788, TR: 792, TM: 795, UA: 804, AE: 784,
  GB: 826, US: 840, UY: 858, UZ: 860, VE: 862, VN: 704, YE: 887
};
const metricsLocation = (country) => (ISO_NUMERIC[String(country).toUpperCase()] ? 2000 + ISO_NUMERIC[String(country).toUpperCase()] : undefined);
const METRICS_LANGUAGE_OVERRIDES = { 'zh-cn': 'zh_CN', 'zh-tw': 'zh_TW', fil: 'tl' };
const metricsLanguage = (language) => {
  const code = String(language || '').toLowerCase();
  return METRICS_LANGUAGE_OVERRIDES[code] || code.split('-')[0];
};

// Google Ads keyword rules: ≤ 80 chars, ≤ 10 words, none of these symbols — one bad keyword fails the whole task.
const BAD_KEYWORD_CHARS = /[,!@%^()={};~`<>?\\|*"[\]]/g;
export function metricsSafeKeyword(value) {
  const cleaned = String(value || '').replace(BAD_KEYWORD_CHARS, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!cleaned || cleaned.length > 80 || cleaned.split(' ').length > 10) return '';
  return cleaned;
}

// DataForSEO uses HTTP Basic auth: the account login + the API password from app.dataforseo.com/api-access
// (not the dashboard password). DATAFORSEO_AUTH (base64 "login:password" or "Basic …") is still accepted.
function metricsAuthHeader() {
  const login = String(process.env.DATAFORSEO_LOGIN || '').trim();
  const password = String(process.env.DATAFORSEO_PASSWORD || '').trim();
  if (login && password) return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
  const auth = String(process.env.DATAFORSEO_AUTH || '').trim();
  if (!auth) return '';
  return auth.startsWith('Basic ') ? auth : `Basic ${auth}`;
}
export const metricsConfigured = () => Boolean(metricsAuthHeader());
export const serpConfigured = () => Boolean(process.env.ISEARCHFROM_API_KEY);

/**
 * Bulk volume / CPC / competition. Returns { status, items }. `status` holds internal fields
 * (provider, cost, error) — strip them with the sanitizers in index.js before replying to a browser.
 */
export async function getKeywordMetrics(keywords, country, language) {
  const unique = Array.from(new Set(keywords.map(metricsSafeKeyword).filter(Boolean))).slice(0, METRICS_MAX_KEYWORDS);
  const locationCode = metricsLocation(country);
  const languageCode = metricsLanguage(language);
  const authorization = metricsAuthHeader();
  const base = {
    provider: authorization ? 'dataforseo' : 'unavailable',
    status: 'not_requested',
    requestedCount: unique.length,
    matchedCount: 0,
    geoCountry: country,
    language,
    locationCode,
    languageCode
  };
  if (!unique.length) return { status: { ...base, status: 'completed', updatedAt: new Date().toISOString() }, items: [] };
  if (!authorization) return { status: { ...base, status: 'unavailable', error: 'DataForSEO credentials are not set' }, items: [] };
  if (!locationCode) return { status: { ...base, status: 'failed', error: `no location code for ${country}` }, items: [] };
  try {
    const response = await postJsonIpv4(
      'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live',
      { Authorization: authorization, 'Content-Type': 'application/json' },
      [{ keywords: unique, location_code: locationCode, language_code: languageCode, search_partners: false }],
      METRICS_TIMEOUT_MS
    );
    const body = response.json;
    const task = body?.tasks?.[0];
    if (!response.ok || !task || task.status_code !== 20000) {
      const error = task?.status_message || body?.status_message || `HTTP ${response.status}`;
      return { status: { ...base, status: 'failed', error, cost: Number(task?.cost || 0) }, items: [] };
    }
    const rawItems = Array.isArray(task.result) ? task.result : [];
    // search_volume: null = Google Ads gives no data for the phrase (restricted / too rare) — that is "no data",
    // not "zero demand", so such rows are left out and the keyword stays without statistics
    const items = rawItems.filter((item) => (item.keyword_info || item).search_volume != null).map((item) => {
      const info = item.keyword_info || item;
      const level = String(info.competition_level || info.competition || '').toUpperCase();
      return {
        keyword: String(item.keyword || '').trim().toLowerCase(),
        volume: Number(info.search_volume || 0),
        cpc: Number(info.cpc || 0),
        competition: ['LOW', 'MEDIUM', 'HIGH'].includes(level) ? level[0] + level.slice(1).toLowerCase() : 'Unknown',
        competitionIndex: Number.isFinite(Number(info.competition_index)) ? Number(info.competition_index) : undefined,
        lowTopOfPageBid: Number(info.low_top_of_page_bid || 0) || undefined,
        highTopOfPageBid: Number(info.high_top_of_page_bid || 0) || undefined,
        monthlySearches: Array.isArray(info.monthly_searches)
          ? info.monthly_searches.slice(0, 24).map((m) => ({ year: Number(m.year), month: Number(m.month), searchVolume: Number(m.search_volume || 0) }))
          : undefined
      };
    }).filter((item) => item.keyword);
    return {
      status: { ...base, status: 'completed', matchedCount: items.length, cost: Number(task.cost || 0), updatedAt: new Date().toISOString() },
      items
    };
  } catch (error) {
    return { status: { ...base, status: 'failed', error: error instanceof Error ? error.message : String(error) }, items: [] };
  }
}

// ------------------------------------------------------------------------------------------ paid SERP

const SERP_LOCALES = { ru: 'ru', es: 'es', de: 'de', pl: 'pl', pt: 'pt', fr: 'fr', it: 'it', tr: 'tr', vi: 'vi' };
export function serpLocale(language, country) {
  const lang = String(language || '').toLowerCase();
  if (lang === 'en') return String(country).toUpperCase() === 'GB' ? 'en-GB' : 'en-US';
  return SERP_LOCALES[lang] || (language.includes('-') ? language : `${language}-${String(country).toUpperCase()}`);
}

function localeMatches(requested, returned) {
  if (!returned) return false;
  const req = requested.toLowerCase();
  const ret = returned.toLowerCase();
  if (req === ret) return true;
  const retParts = ret.split('-');
  return req.split('-')[0] === retParts[0] && (!retParts[1] || retParts[1] === req.split('-')[1]);
}

async function serpRequest(path, init = {}) {
  const key = process.env.ISEARCHFROM_API_KEY;
  if (!key) return null;
  const response = await fetch(`https://api.isearchfrom.com/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': key, ...(init.headers || {}) },
    signal: AbortSignal.timeout(SERP_REQUEST_TIMEOUT_MS)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(body.errors) ? body.errors.map((e) => e.message).filter(Boolean).join('; ') : '';
    throw new Error(`SERP HTTP ${response.status}: ${body.message || body.code || 'request failed'}${details ? ` (${details})` : ''}`);
  }
  return body;
}

const str = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function parseSerp(raw, query) {
  const root = raw?.data || raw || {};
  const items = (Array.isArray(root.pages) ? root.pages : []).flatMap((page) => (Array.isArray(page.items) ? page.items : []));
  const device = root.device === 'mobile' ? 'mobile' : 'desktop';
  const isPaid = (item) => {
    const type = String(item.type || item.resultType || item.result_type || item.kind || '').toLowerCase();
    return item.isAd === true || type === 'ad' || type.includes('paid') || type.includes('sponsored');
  };
  const ads = items.filter(isPaid).slice(0, 20).map((item) => ({
    keyword: query,
    headline: str(item.title || item.headline || item.headline1, 200),
    description: str(item.description || item.description1 || item.snippet, 400),
    displayUrl: str(item.displayUrl || item.display_url || item.visibleUrl || item.visible_url || item.url, 300),
    sitelinks: Array.isArray(item.sitelinks) ? item.sitelinks.slice(0, 8).map((l) => str(l.title || l.url, 120)).filter(Boolean) : [],
    position: Number(item.globalPosition || item.global_position || item.sectionPosition || item.section_position || 0),
    device
  }));
  const organic = items.filter((item) => item.type === 'organic_result').slice(0, 10).map((item) => ({
    title: str(item.title, 200),
    description: str(item.description, 400),
    url: str(item.url, 500),
    displayUrl: str(item.displayUrl, 300),
    position: Number(item.globalPosition || item.sectionPosition || 0)
  }));
  return {
    id: root.id,
    status: String(root.status || 'unknown'),
    language: root.language,
    pageCount: Number(root.pageCount || root.pages?.length || 0),
    ads,
    organic,
    error: typeof root.error === 'string' ? root.error : root.error?.message || root.message
  };
}

/** Creates a SERP task and polls it. Only completed tasks with a verified exact locale are usable. */
export async function runSerpSearch(query, country, language) {
  if (!serpConfigured()) return null;
  const requestedLocale = serpLocale(language, country);
  let created;
  try {
    created = await serpRequest('/tools/serp/proxy-search', {
      method: 'POST',
      body: JSON.stringify({ query, country: String(country).toUpperCase(), language: requestedLocale, engine: 'google', device: 'desktop', pages: [1] })
    });
  } catch (error) {
    return { status: 'failed', requestedLocale, localeVerified: false, ads: [], organic: [], pageCount: 0, error: error.message };
  }
  if (!created?.id && !created?.data?.id) return { status: 'failed', requestedLocale, localeVerified: false, ads: [], organic: [], pageCount: 0, error: 'no task id' };
  const id = String(created.id || created.data.id);
  let raw = created;
  const deadline = Date.now() + SERP_POLL_DEADLINE_MS;
  while (['pending', 'running', 'queued'].includes(String((raw.data || raw).status)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SERP_POLL_INTERVAL_MS));
    try {
      const next = await serpRequest(`/tools/serp/proxy-search/${encodeURIComponent(id)}`);
      if (next) raw = next;
    } catch (e) {
      console.warn('[PpcHelper] SERP poll failed:', e.message);
    }
  }
  const parsed = parseSerp(raw, query);
  parsed.requestedLocale = requestedLocale;
  parsed.localeVerified = localeMatches(requestedLocale, parsed.language);
  if (!parsed.localeVerified) parsed.error = `locale not verified: returned ${parsed.language || 'none'}, requested ${requestedLocale}`;
  if (parsed.status !== 'completed') parsed.error = parsed.error || `SERP status: ${parsed.status}`;
  return parsed;
}
