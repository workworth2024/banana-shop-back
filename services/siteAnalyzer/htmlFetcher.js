/**
 * Server-side HTML fetch — replaces the CORS-blocked client-side fetch from
 * the original policy-scanner-v3 (see its README "Known limitations #1").
 */
const FETCH_TIMEOUT_MS = 20000;
const PROXY_TIMEOUT_MS = 45000;
const MAX_BYTES = 3 * 1024 * 1024; // 3MB cap — landing pages, not SPA bundles

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

async function readCapped(response, controller) {
  const reader = response.body?.getReader?.();
  if (!reader) return response.text();

  const chunks = [];
  let received = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > MAX_BYTES) { controller.abort(); break; }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: BROWSER_HEADERS
    });

    const finalUrl = response.url || url;
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      throw new Error(`Site responded with HTTP ${response.status}`);
    }

    const html = await readCapped(response, controller);

    return { html, finalUrl, contentType, wasRedirected: finalUrl !== url, source: 'direct' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fallback через Jina Reader: сайт может блокировать наш IP/TLS-отпечаток,
 * тогда HTML забирает их headless-браузер. Работает без ключа (лимит ~20 rpm),
 * с JINA_API_KEY — быстрее и стабильнее.
 */
async function fetchViaReader(url) {
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
  const HOPELESS = ['UND_ERR_CONNECT_TIMEOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (error) {
      lastError = error;
      console.error(`[HtmlFetcher] direct attempt ${attempt} failed:`, error.message, error.cause?.code || error.cause?.message || '');
      if (HOPELESS.includes(error.cause?.code) || error.name === 'AbortError') break;
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

  const causeCode = lastError?.cause?.code || '';
  if (/HTTP \d{3}/.test(lastError?.message || '')) {
    throw new Error(`сайт вернул ошибку: ${lastError.message}`);
  }
  if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') {
    throw new Error('домен не резолвится — проверьте адрес');
  }
  if (causeCode === 'CERT_HAS_EXPIRED' || causeCode.startsWith('ERR_TLS') || causeCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    throw new Error('проблема с SSL-сертификатом сайта');
  }

  throw new Error('сайт недоступен с наших серверов (возможна блокировка по IP или сайт лежит)');
}
