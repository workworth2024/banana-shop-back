/**
 * Look-alike / typosquat domain detection against the Tranco top-100k list
 * (research-grade ranking of popular domains, https://tranco-list.eu).
 *
 * Impersonating another brand is an "Unacceptable business practices" violation — Google
 * suspends on detection, without warning — and typo domains (winsscp.com → winscp.net,
 * cricketwirelies.com → cricketwireless.com) are the most common form we see in scans.
 * An LLM can't do this reliably (it doesn't know which domain is the official one), a
 * popularity list + edit distance can.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'tranco-top100k.csv');
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const TRANCO_ID_URL = 'https://tranco-list.eu/top-1m-id';
const TRANCO_LIST_URL = (id) => `https://tranco-list.eu/download/${id}/100000`;
const MAX_BRAND_RANK = 100000;      // exact-name matches (scrap-tf.com ↔ scrap.tf)
const MAX_TYPO_BRAND_RANK = 50000;  // edit-distance matches need a better-known target
const MAX_TOKEN_BRAND_RANK = 10000; // brand as one hyphenated token (amazon-deals.shop)
// Typosquats are registered to be used, not aged: an established domain that happens to be
// one letter away from a popular one (neosurf.com ↔ geosurf.io) is not a look-alike.
const MAX_LOOKALIKE_AGE_DAYS = 730;
// ccSLDs under a 2-letter ccTLD (co.uk, com.br) and CentralNic-style private zones (de.com)
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'or', 'ne', 'go', 'gob', 'nic']);
const PRIVATE_SUFFIXES = new Set(['de.com', 'it.com', 'us.com', 'uk.com', 'eu.com', 'br.com', 'cn.com', 'ru.com',
  'sa.com', 'za.com', 'jpn.com', 'gb.net', 'uk.net', 'com.de', 'co.com']);

let index = null;      // { byLabel: Map<label, {domain, rank}>, byLength: Map<len, label[]>, domains: Set }
let loading = null;

/** "shop.winsscp.co.uk" → { label: "winsscp", domain: "winsscp.co.uk", tld: "co.uk" } */
export function registrable(hostname) {
  const parts = String(hostname || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '').split('.');
  const n = parts.length;
  const suffix2 = parts.slice(-2).join('.');
  const sld = n >= 3 && (PRIVATE_SUFFIXES.has(suffix2) || (SECOND_LEVEL.has(parts[n - 2]) && parts[n - 1].length === 2)) ? 3 : 2;
  const domainParts = parts.slice(-sld);
  return { label: domainParts[0] || '', domain: domainParts.join('.'), tld: domainParts.slice(1).join('.') };
}

const norm = (s) => s.replace(/[^a-z0-9]/g, '');

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

async function readList() {
  try {
    const stat = await fs.stat(CACHE_FILE);
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) return fs.readFile(CACHE_FILE, 'utf-8');
  } catch { /* no cache yet */ }
  try {
    const id = (await (await fetch(TRANCO_ID_URL, { signal: AbortSignal.timeout(15000) })).text()).trim();
    const res = await fetch(TRANCO_LIST_URL(id), { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Tranco HTTP ${res.status}`);
    const csv = await res.text();
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHE_FILE, csv);
    return csv;
  } catch (e) {
    console.error('[Lookalike] Tranco download failed:', e.message);
    return fs.readFile(CACHE_FILE, 'utf-8').catch(() => '');   // stale cache beats nothing
  }
}

async function getIndex() {
  if (index) return index;
  loading ??= (async () => {
    const byLabel = new Map();
    const domains = new Set();
    for (const line of (await readList()).split(/\r?\n/)) {
      const [rankStr, domain] = line.split(',');
      if (!domain) continue;
      const rank = Number(rankStr);
      domains.add(domain);
      if (rank > MAX_BRAND_RANK) continue;
      const { label, tld } = registrable(domain);
      // index both "scrap" and "scraptf" so scrap-tf.com matches scrap.tf
      for (const key of [norm(label), norm(label + tld)]) {
        if (key.length >= 5 && !byLabel.has(key)) byLabel.set(key, { domain, rank });
      }
    }
    const byLength = new Map();
    for (const key of byLabel.keys()) {
      if (!byLength.has(key.length)) byLength.set(key.length, []);
      byLength.get(key.length).push(key);
    }
    index = domains.size ? { byLabel, byLength, domains } : null;
    loading = null;
    return index;
  })();
  return loading;
}

function closest(idx, key, maxDist, maxRank) {
  let best = null;
  for (let len = key.length - maxDist; len <= key.length + maxDist; len++) {
    for (const cand of idx.byLength.get(len) || []) {
      const hit = idx.byLabel.get(cand);
      if (hit.rank > maxRank) continue;
      const d = editDistance(key, cand, maxDist);
      if (d <= maxDist && (!best || hit.rank < best.rank)) best = { ...hit, d };
    }
  }
  return best;
}

/**
 * Returns { isLikely, brand, reason, kind }:
 *   kind "lookalike"     — the whole name copies / misspells a popular domain → impersonation
 *   kind "brand_mention" — a popular brand is one hyphenated token of the name (weaker:
 *                          may be a reseller/fan site, so it raises risk but sets no floor)
 */
export async function detectLookalike(hostname, domainAge = null, lang = 'ru') {
  const en = lang === 'en';
  const none = { isLikely: false, brand: '', reason: '', kind: null };
  try {
    if (domainAge != null && domainAge >= MAX_LOOKALIKE_AGE_DAYS) return none;
    const idx = await getIndex();
    if (!idx) return none;
    const { label, domain } = registrable(hostname);
    if (idx.domains.has(domain)) return none;   // the site itself is a known popular domain
    const key = norm(label);
    if (key.length < 5) return none;

    const exact = idx.byLabel.get(key);
    if (exact && exact.domain !== domain) {
      return { isLikely: true, kind: 'lookalike', brand: exact.domain,
        reason: en ? `The domain name matches the popular site ${exact.domain} (#${exact.rank} in the Tranco ranking), but the zone/spelling differs.`
          : `Имя домена совпадает с популярным сайтом ${exact.domain} (#${exact.rank} в рейтинге Tranco), но зона/написание другие.` };
    }
    const maxDist = key.length >= 10 ? 2 : key.length >= 6 ? 1 : 0;
    const typo = maxDist ? closest(idx, key, maxDist, MAX_TYPO_BRAND_RANK) : null;
    if (typo) {
      return { isLikely: true, kind: 'lookalike', brand: typo.domain,
        reason: en ? `The domain differs from the popular site ${typo.domain} (#${typo.rank} in the Tranco ranking) by ${typo.d} character(s) — classic typosquatting.`
          : `Домен отличается от популярного сайта ${typo.domain} (#${typo.rank} в рейтинге Tranco) на ${typo.d} символ(а) — типичный typosquatting.` };
    }
    for (const token of label.split('-').map(norm).filter(t => t.length >= 6 && t !== key)) {
      const hit = idx.byLabel.get(token);
      const mention = hit && hit.rank <= MAX_TOKEN_BRAND_RANK ? { ...hit, d: 0 } : closest(idx, token, 1, MAX_TOKEN_BRAND_RANK);
      if (mention) {
        return { isLikely: false, kind: 'brand_mention', brand: mention.domain,
          reason: en ? `The domain name uses the third-party brand ${mention.domain}${mention.d ? ' (misspelled)' : ''} (#${mention.rank} in the Tranco ranking).`
            : `В имени домена используется чужой бренд ${mention.domain}${mention.d ? ' (с опечаткой)' : ''} (#${mention.rank} в рейтинге Tranco).` };
      }
    }
    return none;
  } catch (e) {
    console.error('[Lookalike] error:', e.message);
    return none;
  }
}

/** Popular domain closest to a host that doesn't resolve (used for "did you mean …?" in the scan form). */
export async function nearestPopularDomain(hostname) {
  const idx = await getIndex().catch(() => null);
  if (!idx) return null;
  const { label } = registrable(String(hostname).toLowerCase().replace(/^www\./, ''));
  const key = norm(label);
  if (key.length < 4) return null;
  const hit = closest(idx, key, key.length >= 8 ? 2 : 1, MAX_TYPO_BRAND_RANK);
  return hit && hit.d > 0 ? hit.domain : null;
}
