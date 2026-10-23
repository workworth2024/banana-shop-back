/**
 * Server-side HTML fetch — replaces the CORS-blocked client-side fetch from
 * the original policy-scanner-v3 (see its README "Known limitations #1").
 */
import http from 'http';
import https from 'https';
import zlib from 'zlib';
import { BlockedHostError, assertPublicUrl, guardedLookup } from './netGuard.js';

const FETCH_TIMEOUT_MS = 20000;
const PROXY_TIMEOUT_MS = 45000;
const MAX_BYTES = 3 * 1024 * 1024; // 3MB cap — landing pages, not SPA bundles
const MAX_REDIRECTS = 5;

// SSRF guard: the scanner fetches user-supplied URLs from our server, so loopback,
// private, link-local (cloud metadata) and other non-public ranges must be unreachable —
// for the initial URL and for every redirect hop. The IP is checked inside the socket's
// lookup (netGuard.js), so DNS rebinding between "check" and "connect" is impossible.
const BLOCKED_MESSAGES = {
  host: 'адрес недоступен для проверки (внутренний хост или нестандартный порт)',
  scheme: 'адрес недоступен для проверки (внутренний хост или нестандартный порт)',
  ip: 'адрес недоступен для проверки (внутренний или зарезервированный IP)'
};
const blocked = (e) => new BlockedHostError(BLOCKED_MESSAGES[e.message] || BLOCKED_MESSAGES.ip);

// Многие лендинги режут дата-центровые IP и «неизвестные» юзер-агенты,
// поэтому ходим как обычный Chrome
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1'
};

export function normalizeUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) throw new Error('URL is required');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const parsed = new URL(url); // throws on invalid input
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http(s) URLs are supported');
  return parsed.toString();
}

function requestOnce(u, { signal, headers, maxBytes, binary }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { lookup: guardedLookup, signal, agent: false, headers: { ...headers, 'Accept-Encoding': 'gzip, deflate, br' } }, (res) => {
      const status = res.statusCode || 0;
      const flat = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]));
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ status, headers: flat, location: res.headers.location });
      }
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip())
        : enc === 'deflate' ? res.pipe(zlib.createInflate())
          : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks = [];
      let size = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        const buf = Buffer.concat(chunks);
        resolve({ status, headers: flat, body: binary ? buf : buf.toString('utf-8') });
      };
      stream.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { finish(); req.destroy(); return; }
        chunks.push(c);
      });
      stream.on('end', finish);
      stream.on('error', (e) => (size ? finish() : reject(e)));
    });
    req.on('error', reject);
  });
}

async function readCapped(response, controller, maxBytes = MAX_BYTES, binary = false) {
  const reader = response.body?.getReader?.();
  if (!reader) return response.text();

  const chunks = [];
  let received = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > maxBytes) { controller.abort(); break; }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return binary ? buf : buf.toString('utf-8');
}

/**
 * SSRF-guarded GET that follows redirects manually (every hop re-checked) and does NOT
 * throw on HTTP error statuses — used for the page itself and for robots.txt, sitemap and
 * linked policy pages. Returns { status, finalUrl, headers, body, redirects }.
 */
export async function fetchPublic(url, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_BYTES, userAgent, binary = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = userAgent ? { ...BROWSER_HEADERS, 'User-Agent': userAgent } : BROWSER_HEADERS;
  try {
    let finalUrl = url;
    const redirects = [];
    for (let hop = 0; ; hop++) {
      let u;
      try { u = assertPublicUrl(finalUrl); } catch (e) { throw e instanceof BlockedHostError ? blocked(e) : e; }
      let response;
      try {
        response = await requestOnce(u, { signal: controller.signal, headers, maxBytes, binary });
      } catch (e) {
        if (e instanceof BlockedHostError) throw blocked(e);
        throw e;
      }
      if (!response.location) return { status: response.status, finalUrl, headers: response.headers, body: response.body, redirects };
      if (hop >= MAX_REDIRECTS) throw new Error('Site responded with HTTP 310 (too many redirects)');
      redirects.push({ status: response.status, from: finalUrl });
      finalUrl = new URL(response.location, finalUrl).toString();
      if (!/^https?:/i.test(finalUrl)) throw new Error('Site redirects to a non-http(s) URL');
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOnce(url) {
  const r = await fetchPublic(url);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`Site responded with HTTP ${r.status}`);
  }
  return {
    html: r.body, finalUrl: r.finalUrl, contentType: r.headers['content-type'] || '', headers: r.headers,
    status: r.status, redirects: r.redirects, wasRedirected: r.finalUrl !== url, source: 'direct'
  };
}

/**
 * Fallback через Jina Reader: сайт может блокировать наш IP/TLS-отпечаток,
 * тогда HTML забирает их headless-браузер. Работает без ключа (лимит ~20 rpm),
 * с JINA_API_KEY — быстрее и стабильнее.
 */
export async function fetchViaReader(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const headers = {
      'x-respond-with': 'html',
      'x-timeout': '30',
      Accept: 'text/plain'
    };
    if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;

    const response = await fetch(`https://r.jina.ai/${url}`, {
      redirect: 'follow',
      signal: controller.signal,
      headers
    });

    if (!response.ok) throw new Error(`Reader HTTP ${response.status}`);

    const html = await readCapped(response, controller);
    if (!html || html.trim().length < 50) throw new Error('Reader returned empty page');

    return { html, finalUrl: url, contentType: 'text/html', wasRedirected: false, source: 'reader' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches HTML with one automatic retry — plain `fetch()` occasionally throws
 * a generic "fetch failed" on transient DNS/TLS/socket hiccups (undici wraps
 * the real cause in `error.cause`), so a single retry avoids surfacing a false
 * negative to the user for an otherwise reachable site.
 */
export async function fetchHtml(rawUrl) {
  const url = normalizeUrl(rawUrl);
  let lastError = null;

  // Повтор помогает только на «мигающих» ошибках; если хост не пускает или не резолвится —
  // сразу идём в fallback, чтобы не тратить ещё один таймаут
  const HOPELESS = ['UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'];
  const codeOf = (e) => e?.code || e?.cause?.code || '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (error) {
      if (error instanceof BlockedHostError) throw error;
      lastError = error;
      console.error(`[HtmlFetcher] direct attempt ${attempt} failed:`, error.message, codeOf(error) || error.cause?.message || '');
      if (HOPELESS.includes(codeOf(error)) || error.name === 'AbortError') break;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 800));
    }
  }

  try {
    const viaReader = await fetchViaReader(url);
    console.warn('[HtmlFetcher] served via Jina Reader fallback:', url);
    return viaReader;
  } catch (readerError) {
    console.error('[HtmlFetcher] reader fallback failed:', readerError.message, readerError.cause || '');
  }

  if (lastError?.name === 'AbortError') {
    throw new Error('сайт не ответил за 20 секунд — проверьте, открывается ли он');
  }

  const causeCode = codeOf(lastError);
  if (/HTTP \d{3}/.test(lastError?.message || '')) {
    throw new Error(`сайт вернул ошибку: ${lastError.message}`);
  }
  if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') {
    throw new Error('домен не резолвится — проверьте адрес');
  }
  if (causeCode === 'CERT_HAS_EXPIRED' || causeCode.startsWith('ERR_TLS') || causeCode.startsWith('ERR_SSL') || /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(causeCode)) {
    throw new Error('проблема с SSL-сертификатом сайта');
  }

  throw new Error('сайт недоступен с наших серверов (возможна блокировка по IP или сайт лежит)');
}

const FETCH_ERRORS_EN = [
  [/^сайт не ответил/, 'the site did not respond within 20 seconds — check that it opens'],
  [/^сайт вернул ошибку: (.*)$/, 'the site returned an error: $1'],
  [/^домен не резолвится/, "the domain doesn't resolve — check the address"],
  [/^проблема с SSL/, "the site's SSL certificate is broken"],
  [/^сайт недоступен с наших серверов/, "the site isn't reachable from our servers (IP block or the site is down)"],
  [/внутренний хост или нестандартный порт/, "this address can't be scanned (internal host or non-standard port)"],
  [/внутренний или зарезервированный IP/, "this address can't be scanned (internal or reserved IP)"]
];

/** Fetch errors are thrown in Russian; English reports get them translated. */
export function localizeFetchError(message, lang) {
  if (lang !== 'en') return message;
  for (const [re, en] of FETCH_ERRORS_EN) {
    const m = String(message).match(re);
    if (m) return en.replace('$1', m[1] || '');
  }
  return message;
}
