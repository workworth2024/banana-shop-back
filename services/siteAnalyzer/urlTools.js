/**
 * Forgiving URL input: clean what people actually paste/type into a URL field, then check the
 * domain exists before a scan (and a paid credit) is spent on it.
 *
 *   cleanUrlInput('Htps://WWW.Site,com/landing.')  → { url: 'https://www.site.com/landing', fixes: [...] }
 *   await checkUrl('exmaple.con')                  → { ok: false, suggestion: 'https://example.com/' ... }
 *
 * The same rules run in the browser (src/pages/SiteAnalyzer/urlInput.js) for instant feedback;
 * this is the authoritative copy.
 */
import dns from 'dns';
import { tr } from './i18n.js';
import { nearestPopularDomain } from './lookalike.js';

const TLD_TYPOS = {
  con: 'com', cmo: 'com', ocm: 'com', comm: 'com', coom: 'com', cpm: 'com', vom: 'com', xom: 'com', cim: 'com', clm: 'com',
  nte: 'net', ent: 'net', ner: 'net', nett: 'net', met: 'net',
  ogr: 'org', rog: 'org', orgg: 'org', prg: 'org',
  ry: 'ru', tu: 'ru', rur: 'ru'
};
// tried, in order, when the typed domain doesn't resolve
const COMMON_TLDS = ['com', 'net', 'org', 'ru', 'io', 'co', 'shop', 'store', 'online', 'site', 'de', 'uk', 'pro', 'info', 'app'];
const DNS_TIMEOUT_MS = 4000;

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
};

/** Best-effort repair of a typed/pasted URL. Never throws; `url` is null when nothing usable is left. */
export function cleanUrlInput(raw, lang = 'ru') {
  const t = tr(lang);
  const fixes = [];
  let s = String(raw || '').normalize('NFKC').trim();
  if (!s) return { url: null, fixes, reason: t('Введите адрес сайта', 'Enter a site address') };

  s = s.replace(/^[\s"'`«»“”<(\[]+|[\s"'`«»“”>)\]]+$/g, '');
  // e-mail → its domain
  const email = s.match(/^[^\s@/]+@([^\s@/]+\.[^\s@/]+)$/);
  if (email) { s = email[1]; fixes.push(t('взяли домен из e-mail', 'took the domain from the e-mail')); }
  // "google . com" / "site com" / text around a URL
  if (/\s/.test(s)) {
    const token = s.match(/(?:https?:\/\/)?[^\s]+\.[a-z\u0400-\u04ff]{2,}[^\s]*/i);
    if (token) { s = token[0]; fixes.push(t('убрали лишний текст вокруг адреса', 'removed extra text around the address')); }
    else {
      const joined = s.replace(/\s*\.\s*/g, '.').replace(/\s+(?=[a-z]{2,6}$)/i, '.').replace(/\s+/g, '');
      if (joined !== s) { s = joined; fixes.push(t('убрали пробелы', 'removed spaces')); }
    }
  }
  // protocol typos: htps:// http// https:/ hhttps:// ttps:// https;// http:\\ https.//
  const proto = s.match(/^([a-z]{2,7})\s*[:;.]?\s*[\\/]{1,3}/i);
  if (proto && /^h*t+p+s?$|^t+p+s?$|^ht+s$|^htt?ps?$/i.test(proto[1]) && !/^https?:\/\/[^/]/i.test(s)) {
    const secure = /s$/i.test(proto[1]);
    s = `${secure ? 'https' : 'http'}://${s.slice(proto[0].length)}`;
    fixes.push(t('исправили http/https в начале', 'fixed the http/https prefix'));
  } else if (/^\/\//.test(s)) {
    s = `https:${s}`;
  }
  // repeated scheme from pasting into a pre-filled field
  if (/^https?:\/\/https?:\/\//i.test(s)) { s = s.replace(/^https?:\/\//i, ''); fixes.push(t('убрали повтор https://', 'removed a duplicated https://')); }
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;

  let u;
  try { u = new URL(s.replace(/\\/g, '/')); } catch { return { url: null, fixes, reason: t('Не похоже на адрес сайта', "That doesn't look like a site address") }; }
  let host = u.hostname.toLowerCase();
  const hostBefore = host;
  host = host.replace(/,/g, '.').replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '').replace(/^(www\.)+/, 'www.');
  const labels = host.split('.');
  const tld = labels[labels.length - 1];
  if (labels.length > 1 && TLD_TYPOS[tld]) {
    labels[labels.length - 1] = TLD_TYPOS[tld];
    host = labels.join('.');
    fixes.push(t(`исправили зону .${tld} → .${TLD_TYPOS[tld]}`, `fixed .${tld} → .${TLD_TYPOS[tld]}`));
  }
  if (host !== hostBefore && !fixes.some((f) => /зону|fixed \./.test(f))) fixes.push(t('исправили опечатку в домене', 'fixed a typo in the domain'));
  // trailing punctuation after copy-paste from a sentence
  let path = u.pathname.replace(/[.,;:!?]+$/, '');
  if (path !== u.pathname) fixes.push(t('убрали знак препинания в конце', 'removed trailing punctuation'));

  const finalLabels = host.split('.');
  const finalTld = finalLabels[finalLabels.length - 1];
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (!isIp && (finalLabels.length < 2 || !/^([a-z]{2,24}|xn--[a-z0-9-]{2,59})$/.test(finalTld) || finalLabels.some((l) => !l || l.length > 63 || /^-|-$/.test(l)))) {
    return { url: null, fixes, reason: t('Не хватает доменной зоны — например, example.com', 'The domain zone is missing — e.g. example.com') };
  }
  u.hostname = host;
  u.pathname = path || '/';
  u.hash = '';
  return { url: u.toString(), host, fixes };
}

async function resolves(host) {
  try {
    await Promise.race([
      dns.promises.lookup(host),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), DNS_TIMEOUT_MS))
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean + make sure the domain resolves. When it doesn't, look for the nearest variant that does
 * (with/without www, a common TLD close to the typed one) and offer it as a suggestion.
 */
export async function checkUrl(raw, lang = 'ru') {
  const t = tr(lang);
  const cleaned = cleanUrlInput(raw, lang);
  if (!cleaned.url) return { ok: false, url: null, fixes: cleaned.fixes, reason: cleaned.reason };
  const { host } = cleaned;
  if (await resolves(host)) return { ok: true, url: cleaned.url, host, fixes: cleaned.fixes };

  const labels = host.split('.');
  const tld = labels.pop();
  const base = labels.join('.');
  const suggest = (cand) => {
    const u = new URL(cleaned.url);
    u.hostname = cand;
    return {
      ok: false, url: cleaned.url, host, fixes: cleaned.fixes, suggestion: u.toString(),
      reason: t(`Домен ${host} не найден. Возможно, вы имели в виду ${cand}?`, `${host} was not found. Did you mean ${cand}?`)
    };
  };
  // 1) with/without www  2) a misspelt well-known site (winscpp.net → winscp.net)  3) a nearby common TLD
  const www = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  if (await resolves(www)) return suggest(www);
  const popular = await nearestPopularDomain(host);
  if (popular && await resolves(popular)) return suggest(popular);
  for (const x of COMMON_TLDS.filter((c) => c !== tld).sort((a, b) => lev(tld, a) - lev(tld, b)).slice(0, 4)) {
    if (await resolves(`${base}.${x}`)) return suggest(`${base}.${x}`);
  }
  return {
    ok: false, url: cleaned.url, host, fixes: cleaned.fixes,
    reason: t(`Домен ${host} не найден — проверьте адрес.`, `${host} was not found — check the address.`)
  };
}
