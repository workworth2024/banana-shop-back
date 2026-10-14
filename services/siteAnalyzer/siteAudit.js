/**
 * Technical site audit for Google Ads moderation:
 *   - indexability: robots.txt for AdsBot-Google / Googlebot, meta robots, X-Robots-Tag,
 *     canonical, sitemap ("Destination not crawlable" is a disapproval reason)
 *   - page structure: title, description, H1, lang, viewport, structured data, alt texts
 *   - required pages: privacy / terms / cookies / refund / contacts / about — the links are
 *     not just found but opened, so a "Privacy" link that 404s counts as missing
 *   - contacts on the page and cookie consent / Consent Mode (required for EEA/UK/CH traffic
 *     under Google's EU user consent policy)
 */
import { fetchPublic } from './htmlFetcher.js';
import { tr } from './i18n.js';

const AUX_TIMEOUT_MS = 8000;
const AUX_MAX_BYTES = 512 * 1024;
// Google's EU user consent policy covers the EEA, the UK and Switzerland
const CONSENT_GEOS = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH']);
const CMP_PATTERNS = [
  ['Cookiebot', /consent\.cookiebot\.com|cookiebot/i], ['OneTrust', /onetrust|optanon|cookielaw\.org/i],
  ['CookieYes', /cookieyes|cookie-law-info/i], ['Usercentrics', /usercentrics/i], ['iubenda', /iubenda/i],
  ['Didomi', /didomi/i], ['Quantcast Choice', /quantcast\.mgr|choice\.quantcast/i], ['Complianz', /complianz/i],
  ['Termly', /termly\.io/i], ['Osano', /osano/i], ['Klaro', /klaro/i], ['Axeptio', /axept\.io|axeptio/i],
  ['consentmanager', /consentmanager\.net/i], ['Borlabs', /borlabs/i], ['CookieScript', /cookie-script\.com/i]
];

// href/text patterns per required page; checked against <a> link targets and anchor texts
const PAGE_RULES = {
  privacy: { href: /privacy|privacidad|datenschutz|konfidenc|politika-konf|rgpd|gdpr/i, text: /privacy|конфиденциальн|privacidad|datenschutz|confidentialit/i },
  terms:   { href: /terms|\btos\b|conditions|agreement|oferta|soglashenie|agb|cgv|condiciones/i, text: /terms|услови|соглашени|оферт|conditions|agb|términos/i },
  cookies: { href: /cookie/i, text: /cookie|куки/i },
  refund:  { href: /refund|return|vozvrat|widerruf|devoluci|rembourse/i, text: /refund|return policy|возврат|widerruf|devoluci|rembourse/i },
  contact: { href: /contact|kontakt|kontakty|contacto/i, text: /contact|контакт|связаться|kontakt|contacto/i },
  about:   { href: /about|o-nas|o-kompanii|ueber-uns|uber-uns|quienes|a-propos/i, text: /about|о нас|о компании|über uns|quiénes|à propos/i },
  impressum: { href: /impressum|imprint|legal-notice|mentions-legales/i, text: /impressum|imprint|legal notice|mentions légales/i }
};
// German-speaking markets legally require a reachable Impressum (DDG §5 / ECG / UWG)
const IMPRESSUM_GEOS = new Set(['DE', 'AT', 'CH']);
const REFUND_VERTICALS = new Set(['ecom', 'sales', 'nutra', 'software']);

function visibleText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag, name) {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}

function metaContent(html, key, value) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if ((attr(tag, key) || '').toLowerCase() === value) return attr(tag, 'content');
  }
  return null;
}

function links(html, baseUrl) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 8000) {
    const href = attr(m[1], 'href');
    if (!href || /^(javascript:|#)/i.test(href)) continue;
    let abs = null;
    try { abs = new URL(href, baseUrl).toString(); } catch { /* bad href */ }
    out.push({ href, abs, text: visibleText(m[2]).slice(0, 120) });
  }
  return out;
}

// ─── robots.txt ────────────────────────────────────────────────────────────────

function parseRobots(txt) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  const sitemaps = [];
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (key === 'sitemap') sitemaps.push(val);
      else if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  return { groups, sitemaps };
}

function ruleMatches(pattern, path) {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}

/**
 * Google semantics: the most specific matching group wins; AdsBot-Google ignores the
 * global "*" group and only obeys a group that names it explicitly.
 */
function robotsVerdict(robots, agent, path) {
  const group = robots.groups.find((g) => g.agents.includes(agent))
    || (agent === 'adsbot-google' ? null : robots.groups.find((g) => g.agents.includes('*')));
  if (!group) return { allowed: true, rule: null };
  let best = null;
  for (const r of group.rules) {
    if (!r.path && !r.allow) continue; // "Disallow:" (empty) allows everything
    if (ruleMatches(r.path, path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return { allowed: !best || best.allow, rule: best ? `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}` : null };
}

async function checkIndexability({ finalUrl, html, headers, lang }) {
  const t = tr(lang);
  const u = new URL(finalUrl);
  const path = u.pathname + u.search;
  const out = {
    robotsTxt: { found: false, status: null, adsBot: { allowed: true, rule: null }, googlebot: { allowed: true, rule: null } },
    metaRobots: metaContent(html, 'name', 'robots'),
    metaGooglebot: metaContent(html, 'name', 'googlebot'),
    xRobotsTag: headers?.['x-robots-tag'] || null,
    noindex: false,
    canonical: null,
    canonicalOtherHost: false,
    sitemap: { found: false, url: null },
    issues: []
  };
  out.noindex = [out.metaRobots, out.metaGooglebot, out.xRobotsTag].some((v) => /noindex|none/i.test(v || ''));

  const canonTag = (html.match(/<link\b[^>]*rel\s*=\s*["']?canonical["']?[^>]*>/i) || [])[0];
  if (canonTag) {
    try {
      out.canonical = new URL(attr(canonTag, 'href') || '', finalUrl).toString();
      out.canonicalOtherHost = new URL(out.canonical).hostname.replace(/^www\./, '') !== u.hostname.replace(/^www\./, '');
    } catch { /* bad canonical */ }
  }

  let robots = { groups: [], sitemaps: [] };
  try {
    const r = await fetchPublic(`${u.origin}/robots.txt`, { timeoutMs: AUX_TIMEOUT_MS, maxBytes: AUX_MAX_BYTES });
    out.robotsTxt.status = r.status;
    if (r.status === 200 && !/<html/i.test(r.body.slice(0, 300))) {
      out.robotsTxt.found = true;
      robots = parseRobots(r.body);
      out.robotsTxt.adsBot = robotsVerdict(robots, 'adsbot-google', path);
      out.robotsTxt.googlebot = robotsVerdict(robots, 'googlebot', path);
    } else if (r.status >= 500) {
      // Google treats a 5xx robots.txt as "disallow everything" until it recovers
      out.robotsTxt.adsBot = { allowed: false, rule: `robots.txt → HTTP ${r.status}` };
      out.robotsTxt.googlebot = { allowed: false, rule: `robots.txt → HTTP ${r.status}` };
    }
  } catch (e) {
    out.robotsTxt.error = e.message;
  }

  const sitemapUrl = robots.sitemaps[0] || `${u.origin}/sitemap.xml`;
  try {
    const s = await fetchPublic(sitemapUrl, { timeoutMs: AUX_TIMEOUT_MS, maxBytes: AUX_MAX_BYTES });
    if (s.status === 200 && /<(urlset|sitemapindex)\b/i.test(s.body)) out.sitemap = { found: true, url: s.finalUrl };
  } catch { /* no sitemap */ }

  const add = (code, severity, text) => out.issues.push({ code, severity, text });
  if (!out.robotsTxt.adsBot.allowed) add('adsbot_blocked', 'CRITICAL', t(
    `robots.txt закрывает страницу от AdsBot-Google (${out.robotsTxt.adsBot.rule}) — объявления отклонят как «Destination not crawlable».`,
    `robots.txt blocks AdsBot-Google (${out.robotsTxt.adsBot.rule}) — ads will be disapproved as "Destination not crawlable".`));
  if (!out.robotsTxt.googlebot.allowed) add('googlebot_blocked', 'MEDIUM', t(
    `robots.txt закрывает страницу от поискового Googlebot (${out.robotsTxt.googlebot.rule}). На показ рекламы это не влияет (у AdsBot свои правила), но «белый» сайт, спрятанный от поиска, выглядит подозрительно.`,
    `robots.txt blocks the search crawler Googlebot (${out.robotsTxt.googlebot.rule}). Ads aren't affected (AdsBot has its own rules), but a "white" site hidden from search looks suspicious.`));
  if (out.noindex) add('noindex', 'MEDIUM', t(
    'Страница закрыта от индексации (noindex). Для рекламы это не запрет, но для белого сайта выглядит как «скрытая» страница — типичный признак клоаки/дорвея.',
    'The page is noindex. Not a ban for ads, but a "white" page hidden from search is a typical cloaking/doorway sign.'));
  if (out.canonicalOtherHost) add('canonical_other_host', 'HIGH', t(
    `Canonical указывает на другой домен (${out.canonical}) — признак копии чужого сайта.`,
    `Canonical points to another domain (${out.canonical}) — looks like a copy of someone else's site.`));
  if (!out.sitemap.found) add('no_sitemap', 'LOW', t('sitemap.xml не найден.', 'No sitemap.xml found.'));
  return out;
}

// ─── structure ─────────────────────────────────────────────────────────────────

function checkStructure(html, text, lang) {
  const t = tr(lang);
  const title = visibleText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const description = metaContent(html, 'name', 'description') || '';
  const h1 = (html.match(/<h1\b[\s\S]*?<\/h1>/gi) || []).map(visibleText).filter(Boolean);
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const out = {
    title, titleLength: title.length,
    description, descriptionLength: description.length,
    h1Count: h1.length, h1: h1.slice(0, 3),
    h2Count: (html.match(/<h2\b/gi) || []).length,
    lang: attr((html.match(/<html\b[^>]*>/i) || [''])[0], 'lang'),
    viewport: !!metaContent(html, 'name', 'viewport'),
    structuredData: /<script[^>]+application\/ld\+json/i.test(html),
    openGraph: !!metaContent(html, 'property', 'og:title'),
    favicon: /<link\b[^>]*rel\s*=\s*["'][^"']*icon/i.test(html),
    images: imgs.length,
    imagesWithoutAlt: imgs.filter((t) => !(attr(t, 'alt') || '').trim()).length,
    wordCount: text.split(/\s+/).filter((w) => w.length > 1).length,
    issues: []
  };
  const add = (code, severity, text) => out.issues.push({ code, severity, text });
  if (!title) add('no_title', 'HIGH', t('Нет <title>.', 'No <title>.'));
  else if (title.length < 10 || title.length > 70) add('title_length', 'LOW', t(`Длина title ${title.length} симв. (рекомендуется 10–70).`, `Title is ${title.length} chars (10–70 recommended).`));
  if (!description) add('no_description', 'MEDIUM', t('Нет meta description.', 'No meta description.'));
  else if (description.length < 50 || description.length > 170) add('description_length', 'LOW', t(`Длина meta description ${description.length} симв. (рекомендуется 50–170).`, `Meta description is ${description.length} chars (50–170 recommended).`));
  if (out.h1Count === 0) add('no_h1', 'MEDIUM', t('Нет заголовка H1.', 'No H1 heading.'));
  else if (out.h1Count > 1) add('many_h1', 'LOW', t(`${out.h1Count} заголовка H1 — должен быть один.`, `${out.h1Count} H1 headings — there should be one.`));
  if (!out.lang) add('no_lang', 'LOW', t('Не указан язык страницы (<html lang>).', 'Page language is not set (<html lang>).'));
  if (!out.viewport) add('no_viewport', 'MEDIUM', t('Нет meta viewport — страница не адаптирована под мобильные.', 'No meta viewport — the page is not mobile-friendly.'));
  if (out.wordCount < 150) add('thin_content', 'HIGH', t(
    `Мало контента: ${out.wordCount} слов. Тонкий лендинг без информации о бизнесе — частая причина «Insufficient original content».`,
    `Thin content: ${out.wordCount} words. A thin landing page without business info is a common cause of "Insufficient original content".`));
  if (out.images >= 3 && out.imagesWithoutAlt / out.images > 0.5) add('images_no_alt', 'LOW', t(`${out.imagesWithoutAlt} из ${out.images} изображений без alt.`, `${out.imagesWithoutAlt} of ${out.images} images have no alt text.`));
  return out;
}

// ─── required pages, contacts, consent ────────────────────────────────────────

async function verifyPage(url, render) {
  try {
    const r = await fetchPublic(url, { timeoutMs: AUX_TIMEOUT_MS, maxBytes: AUX_MAX_BYTES });
    let words = visibleText(r.body).split(/\s+/).length;
    // SPA sites return the same empty shell for every route — render before judging
    if (r.status === 200 && words < 80 && render) {
      const rendered = await render(r.finalUrl);
      if (rendered) { r.body = rendered.html; words = visibleText(r.body).split(/\s+/).length; }
    }
    const soft404 = /(404|not found|page not found|страница не найдена)/i.test(visibleText(r.body).slice(0, 400)) && words < 400;
    // 401/403/429 = bot protection or rate limit: the page may well exist — unknown, not broken
    if ([401, 403, 429].includes(r.status)) return { status: r.status, ok: null, finalUrl: r.finalUrl };
    return { status: r.status, ok: r.status === 200 && !soft404 && words >= 80, words, finalUrl: r.finalUrl };
  } catch (e) {
    return { status: null, ok: null, error: e.message };
  }
}

async function checkTrustPages({ html, finalUrl, vertical, geo, render, lang }) {
  const t = tr(lang);
  const all = links(html, finalUrl);
  const host = new URL(finalUrl).hostname.replace(/^www\./, '');
  const pages = {};
  const toVerify = [];
  for (const [key, rule] of Object.entries(PAGE_RULES)) {
    const hit = all.find((l) => l.abs && (rule.href.test(l.href) || rule.text.test(l.text)) && !/^mailto:|^tel:/i.test(l.href));
    pages[key] = { found: !!hit, url: hit?.abs || null, text: hit?.text || null, verified: null };
    if (hit?.abs && hit.abs.split('#')[0] !== finalUrl.split('#')[0]) toVerify.push(key);
    else if (hit) pages[key].verified = { ok: true, sameAsPage: true };
  }
  const checks = await Promise.all(toVerify.slice(0, 7).map((k) => verifyPage(pages[k].url, render)));
  toVerify.slice(0, 7).forEach((k, i) => { pages[k].verified = checks[i]; });

  const text = visibleText(html);
  const emails = [...new Set([
    ...(html.match(/mailto:([^"'?\s>]+)/gi) || []).map((m) => m.slice(7)),
    ...(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
  ].map((e) => e.toLowerCase()).filter((e) => !/\.(png|jpe?g|webp|svg|gif)$/.test(e) && !/example\.|sentry|wixpress/.test(e)))].slice(0, 5);
  const phones = [...new Set([
    ...(html.match(/tel:([+\d()\-\s]{6,20})/gi) || []).map((m) => m.slice(4).trim()),
    ...(text.match(/\+\d[\d\s()\-]{7,16}\d/g) || [])
  ])].slice(0, 5);
  const messengers = [...new Set((html.match(/(?:t\.me|wa\.me|api\.whatsapp\.com|viber:)\/?[^"'\s>]*/gi) || []).map((m) => m.split('/')[0]))];
  const address = /\b(street|st\.|avenue|ave\.|road|suite|floor|strasse|straße|calle|улица|ул\.|проспект|офис)\b[^.]{0,80}\d/i.test(text)
    || /<script[^>]+ld\+json[^>]*>[\s\S]*?"(address|PostalAddress)"/i.test(html);
  const ownDomainEmail = emails.some((e) => e.endsWith(`@${host}`) || e.split('@')[1]?.endsWith(`.${host}`));

  const cmp = CMP_PATTERNS.filter(([, re]) => re.test(html)).map(([name]) => name);
  const consentMode = /gtag\(\s*['"]consent['"]\s*,\s*['"]default['"]/i.test(html) || /['"]ad_user_data['"]/i.test(html);
  const cookieBanner = cmp.length > 0 || /cookie[^<]{0,40}(consent|banner|notice|accept)|accept\s+(all\s+)?cookies|принять\s+(все\s+)?cookie/i.test(html);
  const consentRequired = CONSENT_GEOS.has(String(geo || '').toUpperCase());
  const usesGoogleTags = /googletagmanager\.com|gtag\(/i.test(html);

  const issues = [];
  const add = (code, severity, text) => issues.push({ code, severity, text });
  const pageOk = (k) => pages[k].found && pages[k].verified?.ok !== false;
  const brokenNote = (k) => (pages[k].found && pages[k].verified?.ok === false
    ? t(` Ссылка есть, но страница не открывается или пустая (${pages[k].verified.status ?? 'нет ответа'}).`,
        ` The link exists, but the page doesn't open or is empty (${pages[k].verified.status ?? 'no answer'}).`) : '');
  if (!pageOk('privacy')) add('no_privacy', 'HIGH', t(
    `Нет рабочей Privacy Policy.${brokenNote('privacy')} Она обязательна, если сайт собирает любые данные (формы, пиксели).`,
    `No working Privacy Policy.${brokenNote('privacy')} It's required whenever the site collects any data (forms, pixels).`));
  if (!pageOk('terms')) add('no_terms', 'MEDIUM', t(`Нет страницы условий (Terms / оферта).${brokenNote('terms')}`, `No Terms of Service page.${brokenNote('terms')}`));
  if (!pageOk('cookies') && !cookieBanner) add('no_cookies', consentRequired ? 'HIGH' : 'LOW', t('Нет Cookie Policy и баннера согласия на cookie.', 'No Cookie Policy and no cookie consent banner.'));
  if (REFUND_VERTICALS.has(vertical) && !pageOk('refund')) add('no_refund', 'HIGH', t(
    `Нет политики возврата.${brokenNote('refund')} Для продаж это требование политики Misrepresentation (условия возврата и доставки должны быть видны до покупки).`,
    `No refund policy.${brokenNote('refund')} For sales it's a Misrepresentation requirement (return and shipping terms must be visible before purchase).`));
  if (!emails.length && !phones.length && !pageOk('contact')) add('no_contacts', 'HIGH', t('Нет контактов: ни email, ни телефона, ни страницы контактов.', 'No contacts: no email, phone or contact page.'));
  else if (emails.length && !ownDomainEmail && !phones.length) add('thirdparty_email', 'LOW', t(
    `Контакт только на сторонней почте (${emails[0]}) — почта на своём домене выглядит надёжнее.`,
    `The only contact is a third-party mailbox (${emails[0]}) — an address on your own domain looks more trustworthy.`));
  if (!address) add('no_address', 'LOW', t('Не найден физический адрес компании.', 'No physical business address found.'));
  if (!pageOk('about')) add('no_about', 'LOW', t('Нет страницы «О компании».', 'No "About us" page.'));
  if (IMPRESSUM_GEOS.has(String(geo || '').toUpperCase()) && !pageOk('impressum')) add('no_impressum', 'HIGH', t(
    `Нет Impressum.${brokenNote('impressum')} Для ${geo} это обязательная страница с юр. данными компании — без неё сайт выглядит анонимным, а это прямой путь к Misrepresentation.`,
    `No Impressum.${brokenNote('impressum')} In ${geo} a page with the company's legal details is mandatory — without it the site looks anonymous, a direct path to Misrepresentation.`));
  // Consent Mode is usually wired by the CMP or inside the GTM container, which the page
  // HTML doesn't show — only flag it when there's no CMP at all.
  if (consentRequired && usesGoogleTags && !consentMode && !cmp.length) add('no_consent_mode', 'MEDIUM', t(
    `Для ${geo} действует EU user consent policy: с Google-тегами нужен баннер согласия и Consent Mode v2 (ad_user_data / ad_personalization). В коде страницы не найдено ни CMP, ни Consent Mode — если он настроен в GTM, проверьте через Tag Assistant.`,
    `Google's EU user consent policy applies to ${geo}: with Google tags you need a consent banner and Consent Mode v2 (ad_user_data / ad_personalization). Neither a CMP nor Consent Mode was found in the page code — if it's set up in GTM, check with Tag Assistant.`));

  return {
    pages,
    contacts: { emails, phones, messengers, address, ownDomainEmail },
    consent: { cookieBanner, cmp, consentMode, required: consentRequired, usesGoogleTags },
    issues
  };
}

export async function auditSite({ finalUrl, html, headers, vertical, geo, render = null, lang = 'ru' }) {
  const text = visibleText(html);
  const [indexing, trust] = await Promise.all([
    checkIndexability({ finalUrl, html, headers, lang }),
    checkTrustPages({ html, finalUrl, vertical, geo, render, lang })
  ]);
  return { indexing, structure: checkStructure(html, text, lang), trust };
}

export { visibleText };
