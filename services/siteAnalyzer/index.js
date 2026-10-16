import { fetchHtml, normalizeUrl } from './htmlFetcher.js';
import { renderPage } from './renderer.js';
import { analyzeText, checkUniqueness, excludeFalsePositives, localizeTextResults } from './textAnalyzer.js';
import { analyzeSEO } from './seoAnalyzer.js';
import { predictRisk, generateRecs, reverseIPLookup, isAbusedTld } from './riskPredictor.js';
import { getPageSpeed } from './pageSpeedService.js';
import { resolveIp, reverseIpLookup, whoisLookup } from './viewDnsService.js';
import { analyzeComplianceContext } from './aimlApiService.js';
import { VERTICAL_RISK } from './triggers.js';
import { detectLookalike } from './lookalike.js';
import { auditSite, visibleText } from './siteAudit.js';
import { normalizeLang, tr } from './i18n.js';
import { detectVertical, detectGeo } from './detectContext.js';
import { getFavicon } from './favicon.js';

// bump when scan results change meaning — the UI flags reports from older engines as outdated
export const ANALYZER_ENGINE = '2026-10-14.5';
const REGULATED = new Set(['gambling', 'nutra', 'dating', 'crypto', 'finance']);
const VERTICAL_NAMES = {
  general: ['Общая', 'General'], nutra: ['Нутра / здоровье', 'Nutra / health'], gambling: ['Гемблинг', 'Gambling'], dating: ['Дейтинг', 'Dating'],
  crypto: ['Крипта', 'Crypto'], finance: ['Финансы', 'Finance'], software: ['Софт / SaaS', 'Software / SaaS'], sales: ['Продажи', 'Sales'],
  real_estate: ['Недвижимость', 'Real estate'], legal: ['Юридические услуги', 'Legal'], ecom: ['E-commerce', 'E-commerce'], white: ['White', 'White']
};

// Below this many visible words the HTML is an SPA shell (React/Vue/Tilda…): the real
// content only exists after JS runs, so the page is rendered in headless Chrome.
const SPA_MIN_WORDS = 60;

const RISKY_VERTICALS = {
  gambling: ['Гемблинг: реклама разрешена только с сертификацией Google и лицензией в стране таргетинга.',
    'Gambling: ads are allowed only with Google certification and a licence in the targeted country.'],
  crypto: ['Крипта: нужна сертификация Google по политике «Криптовалюты и связанные продукты» для конкретной страны.',
    'Crypto: Google certification under the "Cryptocurrencies and related products" policy is required per country.'],
  finance: ['Финансы: во многих странах обязательна верификация финансовых услуг и лицензия регулятора.',
    'Finance: many countries require financial services verification and a regulator licence.'],
  nutra: ['Нутра/здоровье: медицинские заявления, «до/после» и гарантии результата — частая причина бана.',
    'Nutra/health: medical claims, before/after and guaranteed results are a frequent ban reason.'],
  dating: ['Дейтинг: ограниченная категория, нужна сертификация и строгие требования к контенту.',
    'Dating: a restricted category that needs certification and strict content rules.']
};
const ODD_TEXT = {
  machine: ['Текст выглядит машинным (AI без редактуры).', 'The text reads machine-written (unedited AI).'],
  spun: ['Текст «чудной»: похоже на синонимайз или склейку фрагментов.', 'The text is odd: looks spun or stitched from fragments.'],
  gibberish: ['Текст бессвязный.', 'The text is incoherent.'],
  thin: ['На странице почти нет текста.', 'The page has almost no text.']
};

/** Scanner-measured facts (pass AND fail) handed to the AI as ground truth. */
function buildFacts({ audit, seo, whois, speed, impersonation, renderedVia }) {
  const yn = (v) => (v ? 'yes' : 'no');
  const page = (k) => {
    const p = audit.trust.pages[k];
    if (!p?.found) return 'not found';
    if (p.verified?.ok === false) return `link present but broken (HTTP ${p.verified.status ?? 'no answer'})`;
    return 'present';
  };
  return [
    `HTTPS: ${yn(seo.ssl.hasSSL)}`,
    `AdsBot-Google (the crawler that reviews ad destinations) allowed by robots.txt: ${yn(audit.indexing.robotsTxt.adsBot.allowed)}`,
    `Googlebot (search crawler only — does NOT affect ad review) allowed by robots.txt: ${yn(audit.indexing.robotsTxt.googlebot.allowed)}`,
    `noindex (search only — does NOT block ads): ${yn(audit.indexing.noindex)}`,
    `Privacy policy page: ${page('privacy')}`,
    `Terms page: ${page('terms')}`,
    `Cookie policy page: ${page('cookies')}; cookie consent banner: ${yn(audit.trust.consent.cookieBanner)}${audit.trust.consent.cmp.length ? ` (${audit.trust.consent.cmp.join(', ')})` : ''}`,
    `Refund/returns page: ${page('refund')}`,
    `Contact page: ${page('contact')}; emails on page: ${audit.trust.contacts.emails.length}; phones on page: ${audit.trust.contacts.phones.length}; business address found: ${yn(audit.trust.contacts.address)}`,
    `About page: ${page('about')}`,
    `Impressum page: ${page('impressum')}`,
    `Social profile links: ${seo.social.found.map(s => s.name).join(', ') || 'none'}`,
    `Visible words: ${audit.structure.wordCount}; H1 count: ${audit.structure.h1Count}; page lang attribute: ${audit.structure.lang || 'none'}`,
    `Domain registrar: ${whois.registrar || 'unknown'}`,
    `PageSpeed mobile: ${speed?.mobileScore ?? 'n/a'}`,
    `Look-alike of a popular domain: ${impersonation?.isLikely ? `yes (${impersonation.brand})` : 'no'}`,
    renderedVia ? 'Content is rendered by JavaScript (SPA)' : null
  ].filter(Boolean);
}

function buildWarnings({ lang, whois, verticalKey, impersonation, ai, audit, risk, renderedVia, renderedViaShell, hostname, context }) {
  const t = tr(lang);
  const i = lang === 'en' ? 1 : 0;
  const w = [];
  const add = (level, text, section) => w.push({ level, text, section });
  const vn = (k) => (VERTICAL_NAMES[k] || [k, k])[i];
  if (context?.vertical.mismatch) add('warning', t(
    `Выбрана тематика «${vn(context.vertical.selected)}», но страница похожа на «${vn(context.vertical.detected)}»${context.vertical.evidence.length ? ` (${context.vertical.evidence.slice(0, 3).join(', ')})` : ''}. Требования модерации отличаются — перепроверьте с правильной тематикой.`,
    `You chose "${vn(context.vertical.selected)}", but the page looks like "${vn(context.vertical.detected)}"${context.vertical.evidence.length ? ` (${context.vertical.evidence.slice(0, 3).join(', ')})` : ''}. Moderation rules differ — re-scan with the right vertical.`), 'overview');
  if (context?.geo.mismatch) add('warning', t(
    `Выбрана страна ${context.geo.selected}, но сайт ориентирован на ${context.geo.detected}${context.geo.evidence.length ? ` (${context.geo.evidence.join(', ')})` : ''}. Проверьте, куда вы на самом деле будете лить трафик.`,
    `You chose ${context.geo.selected}, but the site targets ${context.geo.detected}${context.geo.evidence.length ? ` (${context.geo.evidence.join(', ')})` : ''}. Double-check where you'll actually send traffic.`), 'overview');
  if (impersonation?.isLikely) add('critical', t(`Похоже на имперсонацию ${impersonation.brand || 'чужого бренда'}. `, `Looks like impersonation of ${impersonation.brand || 'another brand'}. `) + impersonation.reason, 'domain');
  if (whois.domainAge != null && whois.domainAge < 30) add('warning', t(`Сайт совсем новый: домену ${whois.domainAge} дн. Это не нарушение, но к свежим доменам у систем Google меньше доверия — начинайте с небольших бюджетов.`, `Brand-new site: the domain is ${whois.domainAge} days old. Not a violation, but Google's systems trust fresh domains less — start with small budgets.`), 'domain');
  else if (whois.domainAge != null && whois.domainAge < 90) add('warning', t(`Сайт новый: домену ${whois.domainAge} дн. Свежие домены получают повышенное внимание модерации.`, `New site: the domain is ${whois.domainAge} days old. Fresh domains get extra moderation attention.`), 'domain');
  else if (whois.domainAge == null) add('info', t('Возраст домена определить не удалось.', 'The domain age could not be determined.'), 'domain');
  if (RISKY_VERTICALS[verticalKey]) add('warning', t('Рисковая тематика. ', 'Risky vertical. ') + RISKY_VERTICALS[verticalKey][i], 'overview');
  if (isAbusedTld(hostname)) {
    const tld = hostname.split('.').pop();
    add('warning', t(`Зона .${tld} — в топе по злоупотреблениям (фишинг/спам), к ней у модерации меньше доверия.`, `.${tld} is among the most abused zones (phishing/spam), moderation trusts it less.`), 'domain');
  }
  const rv = ai?.review;
  if (rv?.banRisk === 'critical' || rv?.banRisk === 'high') {
    add(rv.banRisk === 'critical' ? 'critical' : 'warning', rv.banRisk === 'critical'
      ? t('AI-проверка текста: критический риск бана — подробности в разделе «Контент и обещания».', 'AI copy review: critical ban risk — see "Copy & claims".')
      : t('AI-проверка текста: высокий риск отклонения объявлений — подробности в разделе «Контент и обещания».', 'AI copy review: high risk of disapproval — see "Copy & claims".'), 'content');
  }
  if (ODD_TEXT[rv?.contentQuality]) add('warning', `${ODD_TEXT[rv.contentQuality][i]} ${rv.contentQualityNote || ''}`.trim(), 'content');
  const sectionOf = { indexing: 'indexing', trust: 'trust', structure: 'structure' };
  for (const [part, issues] of [['indexing', audit.indexing.issues], ['trust', audit.trust.issues], ['structure', audit.structure.issues]]) {
    for (const x of issues) {
      if (x.severity === 'CRITICAL') add('critical', x.text, sectionOf[part]);
      else if (x.severity === 'HIGH') add('warning', x.text, sectionOf[part]);
    }
  }
  if (renderedVia && renderedViaShell) add('info', t('Сайт собран на JavaScript (SPA): контент проверен после рендера в браузере. Убедитесь, что AdsBot видит тот же текст.', 'The site is built with JavaScript (SPA): content was checked after rendering in a browser. Make sure AdsBot sees the same text.'), 'structure');
  if (risk.level === 'LOW' && !w.some(x => x.level !== 'info')) add('ok', t('Явных проблем не найдено.', 'No obvious problems found.'), 'overview');
  const order = { critical: 0, warning: 1, info: 2, ok: 3 };
  return w.sort((a, b) => order[a.level] - order[b.level]);
}

/**
 * Runs a full site scan: fetch HTML (rendered when it's an SPA), local heuristics, technical
 * audit (indexing, structure, required pages, contacts, consent), PageSpeed + RDAP + ViewDNS,
 * and a fact-grounded AI review. All texts are in `lang` (the language selected on the site).
 */
export async function runSiteScan({ url, vertical = 'general', geo = 'US', lang = 'ru' }) {
  const L = normalizeLang(lang);
  const t = tr(L);
  const normalizedUrl = normalizeUrl(url);
  // 'auto' (or anything unknown) = work it out from the page itself
  const autoVertical = !VERTICAL_RISK[vertical];
  const autoGeo = !/^[A-Za-z]{2}$/.test(String(geo || ''));

  const page = await fetchHtml(normalizedUrl);
  const { finalUrl } = page;
  let html = page.html;
  let renderedVia = null;
  // Also render when the raw HTML has no privacy link: footers with policy links are often
  // injected by JS (Shopify/Next.js themes), and they're what the reviewer actually sees.
  const isShell = visibleText(html).split(/\s+/).filter(Boolean).length < SPA_MIN_WORDS;
  const noPolicyLinks = !/href=["'][^"']*(privacy|datenschutz|konfidenc|privacidad|politika)/i.test(html);
  if (page.source === 'direct' && (isShell || noPolicyLinks)) {
    const rendered = await renderPage(finalUrl);
    const linkCount = (h) => (h.match(/<a\b/gi) || []).length;
    if (rendered && (visibleText(rendered.html).length > visibleText(html).length || linkCount(rendered.html) > linkCount(html))) {
      html = rendered.html;
      renderedVia = rendered.via;
    }
  }
  const bodyText = visibleText(html);
  const hostname = new URL(finalUrl).hostname;

  const vDet = detectVertical({
    text: bodyText,
    title: visibleText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''),
    description: (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i) || [])[1] || ''
  });
  const gDet = detectGeo({ hostname, html, text: bodyText, headers: page.headers || {} });
  let verticalKey = autoVertical ? vDet.value : vertical;
  let geoKey = autoGeo ? (gDet.value && gDet.confidence !== 'low' ? gDet.value : 'US') : String(geo).toUpperCase();

  const textResults = analyzeText(bodyText, '', '', '');
  textResults.uniqueness = checkUniqueness(bodyText);

  const seoResults = analyzeSEO(finalUrl, html, '', '');

  // External lookups run concurrently; the AI review waits for WHOIS + the audit + PageSpeed
  // is NOT awaited by it (it can take 50s) — speed goes into the facts only if already known.
  const speedPromise = getPageSpeed(finalUrl);
  const [speed, reverseIp, favicon, { whois, lookalike, audit, aiCompliance }] = await Promise.all([
    speedPromise,
    resolveIp(hostname).then(ip => (ip ? reverseIpLookup(ip) : null)),
    getFavicon(html, finalUrl).catch(() => null),
    Promise.all([
      whoisLookup(hostname).then(async (w) => ({ whois: w, lookalike: await detectLookalike(hostname, w.domainAge, L) })),
      auditSite({ finalUrl, html, headers: page.headers || {}, vertical: verticalKey, geo: geoKey, render: isShell && renderedVia ? renderPage : null, lang: L })
    ]).then(async ([{ whois: w, lookalike: lk }, a]) => ({
      whois: w,
      lookalike: lk,
      audit: a,
      aiCompliance: await analyzeComplianceContext({
        url: finalUrl,
        vertical: verticalKey,
        geo: geoKey,
        textExcerpt: bodyText,
        triggerIssues: textResults.issues,
        title: a.structure.title,
        description: a.structure.description,
        domainAge: w.domainAge,
        facts: buildFacts({ audit: a, seo: seoResults, whois: w, speed: null, impersonation: lk.isLikely ? lk : null, renderedVia }),
        wordCount: a.structure.wordCount,
        lang: L
      })
    }))
  ]);
  // the AI read the whole page: it settles what the keyword/locale heuristics couldn't
  let vSource = autoVertical ? 'auto' : 'user';
  let gSource = autoGeo ? (gDet.value && gDet.confidence !== 'low' ? 'auto' : 'default') : 'user';
  if (autoVertical && vDet.value === 'general' && VERTICAL_RISK[aiCompliance.pageVertical] && aiCompliance.pageVertical !== 'general') {
    verticalKey = aiCompliance.pageVertical; vSource = 'ai';
  }
  if (autoGeo && gSource === 'default' && aiCompliance.pageCountry) { geoKey = aiCompliance.pageCountry; gSource = 'ai'; }
  const detectedVertical = vDet.value !== 'general' ? vDet.value : (VERTICAL_RISK[aiCompliance.pageVertical] ? aiCompliance.pageVertical : 'general');
  const detectedGeo = gDet.value && gDet.confidence !== 'low' ? gDet.value : (aiCompliance.pageCountry || null);
  const context = {
    vertical: {
      selected: autoVertical ? 'auto' : vertical, used: verticalKey, detected: detectedVertical, source: vSource,
      confidence: vDet.value !== 'general' ? vDet.confidence : (aiCompliance.pageVertical ? 'medium' : 'low'), evidence: vDet.evidence,
      // only worth a warning when the page is in a stricter (regulated) vertical than the one chosen,
      // and the keyword signal is strong or the AI read the page the same way
      mismatch: !autoVertical && REGULATED.has(detectedVertical) && detectedVertical !== vertical
        && (vDet.confidence === 'high' || (vDet.value === detectedVertical && aiCompliance.pageVertical === detectedVertical) || (vDet.value === 'general' && aiCompliance.pageVertical === detectedVertical))
    },
    geo: {
      selected: autoGeo ? 'auto' : String(geo).toUpperCase(), used: geoKey, detected: detectedGeo, source: gSource,
      confidence: gDet.value ? gDet.confidence : (aiCompliance.pageCountry ? 'medium' : 'low'), evidence: gDet.evidence,
      mismatch: !autoGeo && !!detectedGeo && detectedGeo !== String(geo).toUpperCase() && gDet.confidence === 'high'
    }
  };
  const ip = reverseIp?.ip || null;
  seoResults.speed = speed;
  seoResults.audit = audit;

  // trust flags from the audit (links opened and verified) instead of keyword presence
  const pageOk = (k) => audit.trust.pages[k].found && audit.trust.pages[k].verified?.ok !== false;
  Object.assign(seoResults.structure, {
    hasPrivacy: pageOk('privacy'),
    hasTerms: pageOk('terms'),
    hasCookiePolicy: pageOk('cookies') || audit.trust.consent.cookieBanner,
    hasAbout: pageOk('about'),
    hasContact: audit.trust.contacts.emails.length > 0 || audit.trust.contacts.phones.length > 0 || pageOk('contact')
  });

  seoResults.whois = {
    domainAge: whois.domainAge,
    createdDate: whois.createdDate || null,
    expiresDate: whois.expiresDate || null,
    registrar: whois.registrar,
    source: whois.source,
    hosting: reverseIp?.isShared ? 'Shared hosting' : 'Dedicated / unknown',
    ip,
    country: null,
    asn: null,
    reverseDns: hostname,
    issues: [
      ...(whois.domainAge != null && whois.domainAge < 90
        ? [t(`Домен создан ${whois.domainAge} дней назад. Свежие домены (< 90 дней) получают повышенное внимание модерации.`, `The domain was registered ${whois.domainAge} days ago. Fresh domains (< 90 days) get extra moderation attention.`)]
        : []),
      ...(reverseIp?.isShared ? [t('Shared hosting — IP используется несколькими доменами. Риск «плохих соседей».', 'Shared hosting — the IP serves several domains. "Bad neighbour" risk.')] : []),
      ...(whois.source === 'unavailable' ? [t('Возраст домена не удалось определить (RDAP/WHOIS недоступен для этой зоны).', 'The domain age could not be determined (RDAP/WHOIS unavailable for this zone).')] : [])
    ]
  };
  seoResults.reverseIP = reverseIp || reverseIPLookup(ip, seoResults.whois.hosting);

  const falseTexts = new Set((aiCompliance.findings || [])
    .filter(f => f && f.isRealRisk === false && f.text)
    .map(f => String(f.text).toLowerCase()));
  const scoredText = localizeTextResults(excludeFalsePositives(textResults, falseTexts), L);

  // Deterministic look-alike check first (an LLM doesn't know which domain is the official
  // one); the AI verdict only adds cases where the page itself claims a foreign brand.
  // An AI-only impersonation verdict (no look-alike domain) is a warning, not a score floor: the
  // model sometimes reads a common word in the name ("marketplacer…") as a foreign brand.
  const impersonation = lookalike.isLikely ? lookalike
    : aiCompliance.impersonation?.isLikely ? { ...aiCompliance.impersonation, isLikely: false, kind: 'brand_mention', source: 'ai' }
    : lookalike.kind ? lookalike : null;
  if (aiCompliance.review) {
    const t2 = audit.trust;
    const businessInfoComplete = (t2.contacts.emails.length || t2.contacts.phones.length) && t2.contacts.address
      && ['contact', 'about', 'privacy'].every((k) => t2.pages[k]?.found && t2.pages[k].verified?.ok !== false);
    aiCompliance.review.issues = aiCompliance.review.issues
      // the scanner verified contacts, address and company pages — "no business info" contradicts the facts
      .filter((i) => !(i.category === 'missing_business_info' && businessInfoComplete))
      // impersonation needs a look-alike domain to be CRITICAL
      .map((i) => (i.category === 'impersonation' && i.severity === 'CRITICAL' && !lookalike.isLikely ? { ...i, severity: 'HIGH' } : i));
    // the overall copy risk can't exceed what the remaining findings support
    const RANK = ['low', 'medium', 'high', 'critical'];
    const worst = aiCompliance.review.issues.reduce((m, i) => Math.max(m, ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].indexOf(i.severity)), 0);
    // copy-only issues (claims, reviews, urgency…) lead to disapprovals/warnings, not bans
    const hardIssue = aiCompliance.review.issues.some((i) => ['impersonation', 'restricted_content', 'health_claims', 'financial_promises'].includes(i.category) && i.severity !== 'LOW');
    const cap = Math.max(hardIssue ? worst : Math.min(worst, 1), impersonation?.isLikely ? 3 : 0);
    const cur = RANK.indexOf(aiCompliance.review.banRisk);
    if (cur > cap) aiCompliance.review.banRisk = RANK[cap];
  }
  seoResults.impersonation = impersonation;
  aiCompliance.impersonation = impersonation;

  const risk = predictRisk(scoredText, seoResults, verticalKey, geoKey, impersonation, aiCompliance.review, L);
  const recs = generateRecs(risk, scoredText, seoResults, verticalKey, geoKey, impersonation, L);

  return {
    url: finalUrl,
    vertical: verticalKey,
    geo: geoKey,
    lang: L,
    engine: ANALYZER_ENGINE,
    favicon,
    scannedAt: new Date().toISOString(),
    renderedVia,
    warnings: buildWarnings({
      lang: L, whois, verticalKey, impersonation, ai: aiCompliance, audit, risk, renderedVia, renderedViaShell: isShell, hostname, context
    }),
    context,
    text: scoredText,
    seo: seoResults,
    risk,
    recommendations: recs,
    ai: {
      compliance: aiCompliance,
      // kept for reports saved before the page review existed (old UI reads this field)
      banRiskNarrative: { available: !!aiCompliance.review?.verdict, narrative: aiCompliance.review?.verdict || null }
    }
  };
}
