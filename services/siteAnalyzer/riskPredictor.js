/**
 * Reverse-IP demo lookup, ML-style weighted risk predictor and the
 * recommendation engine. Ported from policy-scanner-v3/scanner-engine.js
 * (PARTS 5-7). `reverseIPLookup` here is a last-resort fallback used only
 * if the real ViewDNS API call fails — see viewDnsService.js for the
 * production path.
 */
import { VERTICAL_RISK, getGeoRisk } from './triggers.js';
import { tr } from './i18n.js';

// PART 5: REVERSE IP LOOKUP
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Reverse IP database — demo data for Cloudflare shared hosting.
 * TODO BACKEND: Replace with real API call to ViewDNS or SecurityTrails.
 */
export const REVERSE_IP_DB = {
  cloudflare: {
    ip: "172.67.205.196", asn: "AS13335", totalDomains: 847,
    sampleNeighbors: [
      { domain: "readcorner.site",       category: "education",  risk: "low",    notes: "Целевой домен" },
      { domain: "booknest.io",           category: "education",  risk: "low",    notes: "Библиотечный сервис" },
      { domain: "quickloans-now.com",    category: "finance",    risk: "high",   notes: "⚠️ Payday loans" },
      { domain: "casino-pulse.xyz",      category: "gambling",   risk: "high",   notes: "🔴 iGaming без лицензии" },
      { domain: "nutra-max.guru",        category: "nutra",      risk: "medium", notes: "🟡 Health claims без FDA" },
      { domain: "dating-spot.me",        category: "dating",     risk: "medium", notes: "🟡 Adult dating" },
      { domain: "crypto-pump-signals.io", category: "crypto",     risk: "high",   notes: "⚠️ Pump signals" },
      { domain: "cheap-meds-no-rx.com",  category: "pharma",     risk: "high",   notes: "🔴 Фарма без рецепта" },
      { domain: "adult-streams.live",    category: "adult",      risk: "high",   notes: "🔴 Adult content" },
      { domain: "vps-hosting-pro.net",   category: "hosting",    risk: "low",    notes: "Хостинг-провайдер" },
    ],
    riskAnalysis: { highRiskNeighbors: 5, mediumRiskNeighbors: 2, lowRiskNeighbors: 3,
      summary: "На этом IP обнаружено 5 высокорисковых соседей (гемблинг, нутра, adult, crypto signals, фарма). Риск «плохих соседей» — если Google забанит соседний домен, ваш может попасть под перекрёстную проверку." }
  },
  digitalocean: {
    ip: "138.68.45.123", asn: "AS14061", totalDomains: 1,
    sampleNeighbors: [{ domain: "yourdomain.com", category: "your", risk: "low", notes: "Единственный домен на IP" }],
    riskAnalysis: { highRiskNeighbors: 0, mediumRiskNeighbors: 0, lowRiskNeighbors: 1,
      summary: "Выделенный IP — нет соседей. Максимальная изоляция." }
  }
};

export function reverseIPLookup(ip, hosting) {
  // Demo neighbours must never be shown as a real scan result: only an explicit
  // provider match (never the URL text) selects them.
  let provider = "unknown";
  if (hosting && hosting.includes("Cloudflare")) provider = "cloudflare";
  else if (hosting && hosting.includes("DigitalOcean")) provider = "digitalocean";

  const data = REVERSE_IP_DB[provider];
  if (!data) {
    return {
      ip: ip || "Unknown", totalDomains: 0, neighbors: [],
      riskAnalysis: { highRiskNeighbors: 0, mediumRiskNeighbors: 0, lowRiskNeighbors: 0,
        summary: "Нет данных о соседях. Для получения используйте Reverse IP API (viewdns.info, securitytrails.com)." },
      apiEndpoint: "https://api.hackertarget.com/reverseiplookup/?q=" + (ip || "")
    };
  }
  return { ip: data.ip, asn: data.asn, totalDomains: data.totalDomains, neighbors: data.sampleNeighbors,
    riskAnalysis: data.riskAnalysis, provider, isShared: data.totalDomains > 1,
    apiEndpoint: "https://api.hackertarget.com/reverseiplookup/?q=" + data.ip };
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 6: ML RISK PREDICTOR
// ══════════════════════════════════════════════════════════════════════════════

// Points per unique confirmed trigger phrase. Circumventing systems / misrepresentation are
// "egregious" in Google's policy (suspension on detection, no warning), so one confirmed
// CRITICAL phrase must matter more than any amount of missing social links.
const TRIGGER_POINTS = { CRITICAL: 50, HIGH: 25, MEDIUM: 12 };
const HARD_AI_CATEGORIES = new Set(['impersonation', 'restricted_content', 'health_claims', 'financial_promises']);
// Google: "Unreliable claims" violations get a warning at least 7 days before any suspension —
// fixable copy issues, unlike egregious Misrepresentation (scams, impersonation)
const SOFT_AI_POINTS = { CRITICAL: 10, HIGH: 8, MEDIUM: 4 };
const SOFT_AI_CAP = 25;
// Score floors for confirmed evidence: a weighted average alone dilutes a single egregious
// finding below LOW/MEDIUM thresholds.
const FLOOR_CRITICAL_TRIGGER = 70;   // ≥1 confirmed CRITICAL phrase → at least HIGH
const FLOOR_IMPERSONATION = 65;      // AI: look-alike of someone else's brand → at least HIGH
const FLOOR_MULTIPLE_HIGH = 45;      // ≥3 confirmed HIGH phrases → at least MEDIUM
const FLOOR_AI_CRITICAL = 60;        // AI review found a CRITICAL policy problem → at least HIGH
const FLOOR_ADSBOT_BLOCKED = 60;     // robots.txt blocks AdsBot → ads get disapproved for sure

// New gTLDs with the highest phishing abuse in Interisle's Feb–Apr 2026 data (Cybercrime
// Information Center) plus long-standing cheap "throwaway" zones. Not a policy rule — a
// prior: Google's risk systems see the same abuse statistics.
const ABUSED_TLDS = new Set([
  'top', 'sbs', 'click', 'garden', 'beer', 'cam', 'win', 'boats', 'xyz', 'icu', 'cfd', 'bond',
  'lol', 'rest', 'buzz', 'cyou', 'shop', 'online', 'site', 'store'
]);

export const isAbusedTld = (hostname) => ABUSED_TLDS.has(String(hostname || '').toLowerCase().split('.').pop());

export function domainRiskScore(hostname, whois, impersonation, lang = 'ru') {
  const t = tr(lang);
  let score = 0;
  const reasons = [];
  const age = whois?.domainAge;
  const ageText = (d) => (d < 365 ? t(`домену ${d} дн.`, `domain is ${d} days old`) : t(`домену ${Math.floor(d / 365)} г.`, `domain is ${Math.floor(d / 365)} y old`));
  // Google lists *account* maturity, not domain age, among its trust factors — a fresh domain is
  // a prior from abuse statistics (most phishing domains are days old), not a policy problem
  if (age != null && age < 30) score += 40;
  else if (age != null && age < 90) score += 25;
  else if (age != null && age < 180) score += 10;
  reasons.push(age != null ? ageText(age) : t('возраст домена неизвестен', 'domain age unknown'));
  const tld = String(hostname || '').toLowerCase().split('.').pop();
  if (ABUSED_TLDS.has(tld)) { score += 25; reasons.push(t(`зона .${tld} — в топе по злоупотреблениям`, `.${tld} is a top-abused zone`)); }
  if (impersonation?.isLikely) { score += 60; reasons.push(t(`похоже на имперсонацию ${impersonation.brand || 'бренда'}`, `looks like impersonation of ${impersonation.brand || 'a brand'}`)); }
  // the AI alone (no look-alike in our popular-domain list) is a weak hint, often a common word
  else if (impersonation?.kind === 'brand_mention') { score += impersonation.source === 'ai' ? 10 : 30; reasons.push(t(`в имени чужой бренд ${impersonation.brand}`, `third-party brand in the name: ${impersonation.brand}`)); }
  return { score: Math.min(100, score), explain: reasons.join(', ') };
}

export function textTriggerScore(textResults, aiReview = null) {
  const seen = new Set();
  let points = 0;
  for (const i of textResults.issues || []) {
    const key = String(i.text).toLowerCase();
    if (i.falsePositive || seen.has(key)) continue;
    seen.add(key);
    points += TRIGGER_POINTS[i.severity] || 0;
  }
  // AI page-review findings. Hard ones (posing as a brand, prohibited content, regulated health /
  // money claims) count like trigger phrases. Judgement calls about the copy — "inflated" numbers,
  // reviews on a new domain, a missing detail — are what a reviewer may question, not what gets an
  // account banned, and the model's severity for them varies run to run: they weigh about half and
  // together can't push the factor past SOFT_AI_CAP. LOW findings are advice, not risk.
  let soft = 0;
  for (const i of aiReview?.issues || []) {
    if (HARD_AI_CATEGORIES.has(i.category)) points += TRIGGER_POINTS[i.severity] || 0;
    else soft += SOFT_AI_POINTS[i.severity] || 0;
  }
  return Math.min(100, points + Math.min(SOFT_AI_CAP, soft));
}

/**
 * Heuristic ban-risk score: 8 weighted factors + floors for confirmed egregious findings.
 * Weights are expert-set, not trained — there is no labelled ban-outcome data yet.
 * Site-dependent evidence (text, domain, trust) carries ~70% of the weight; vertical and
 * GEO, which don't depend on the page, ~23% (they used to carry 43%, so every page in the
 * same vertical/GEO looked alike and 45/50 scans landed in LOW).
 */
export function predictRisk(textResults, seoResults, vertical, geo, impersonation = null, aiReview = null, lang = 'ru') {
  const t = tr(lang);
  const geoData = getGeoRisk(geo, lang);
  const vertData = VERTICAL_RISK[vertical] || VERTICAL_RISK['general'];
  const confirmed = (textResults.issues || []).filter(i => !i.falsePositive);
  const confirmedCritical = confirmed.filter(i => i.severity === 'CRITICAL').length;
  const confirmedHigh = confirmed.filter(i => i.severity === 'HIGH').length;
  const domain = domainRiskScore(seoResults.whois?.reverseDns, seoResults.whois, impersonation, lang);

  const yes = (v) => (v ? '✅' : '❌');
  const social = seoResults.social.found;
  // `key` is stable for the UI; `name` / `explain` are in the report language
  const factors = [
    { key: 'content', name: t('Текст и обещания (триггеры + AI)', 'Copy & claims (triggers + AI)'), score: textTriggerScore(textResults, aiReview), weight: 0.35,
      explain: t(`Триггерных фраз: ${confirmed.length}${aiReview ? `, проблем по AI-проверке: ${aiReview.issues.filter(i => i.severity !== 'LOW').length}` : ''}.`,
        `Trigger phrases: ${confirmed.length}${aiReview ? `, AI review issues: ${aiReview.issues.filter(i => i.severity !== 'LOW').length}` : ''}.`) },
    { key: 'domain', name: t('Домен: возраст, зона, бренд', 'Domain: age, zone, brand'), score: domain.score, weight: 0.20, explain: domain.explain },
    { key: 'vertical', name: t('Тематика', 'Vertical'), score: vertData.base, weight: 0.17,
      explain: t(`«${vertData.label}» — базовый риск ${vertData.base}%.`, `"${vertData.label}" — base risk ${vertData.base}%.`) },
    { key: 'trust', name: t('Доверие и обязательные страницы', 'Trust & required pages'), score: calculateSEORiskScore(seoResults), weight: 0.15,
      explain: seoResults.ssl.hasSSL
        ? t(`HTTPS ✅ · Privacy ${yes(seoResults.structure.hasPrivacy)} · Контакты ${yes(seoResults.structure.hasContact)} · Условия ${yes(seoResults.structure.hasTerms)}`,
            `HTTPS ✅ · Privacy ${yes(seoResults.structure.hasPrivacy)} · Contacts ${yes(seoResults.structure.hasContact)} · Terms ${yes(seoResults.structure.hasTerms)}`)
        : t('Нет HTTPS — критический минус.', 'No HTTPS — a critical minus.') },
    { key: 'geo', name: t('GEO-модерация', 'GEO moderation'), score: geoData.risk, weight: 0.06,
      explain: `${geoData.name} (Tier ${geoData.tier}): ${geoData.explain}` },
    { key: 'uniqueness', name: t('Уникальность текста', 'Text uniqueness'), score: 100 - (textResults.uniqueness?.score ?? 50), weight: 0.03,
      explain: textResults.uniqueness?.score != null ? t(`Уникальность: ${textResults.uniqueness.score}%`, `Uniqueness: ${textResults.uniqueness.score}%`) : t('Не проверена.', 'Not checked.') },
    { key: 'social', name: t('Соцсети', 'Social proof'), score: social.length === 0 ? 60 : Math.max(0, 30 - social.length * 5), weight: 0.02,
      explain: social.length ? social.map(x => x.name).join(', ') : t('Соцсети не найдены.', 'No social profiles found.') },
    { key: 'speed', name: t('Скорость загрузки', 'Load speed'), score: Math.max(0, 100 - (seoResults.speed?.mobileScore ?? 50)), weight: 0.02,
      explain: seoResults.speed?.mobileScore != null ? `Mobile: ${seoResults.speed.mobileScore}/100${seoResults.speed.loadTime != null ? ` (${seoResults.speed.loadTime}s)` : ''}` : t('Не проверена.', 'Not checked.') }
  ];

  let totalWeighted = 0, totalWeight = 0;
  factors.forEach(f => { totalWeighted += f.score * f.weight; totalWeight += f.weight; });
  let finalScore = Math.round(totalWeighted / totalWeight);
  if (confirmedCritical > 0) finalScore = Math.max(finalScore, FLOOR_CRITICAL_TRIGGER);
  if (impersonation?.isLikely) finalScore = Math.max(finalScore, FLOOR_IMPERSONATION);
  if (confirmedHigh >= 3) finalScore = Math.max(finalScore, FLOOR_MULTIPLE_HIGH);
  if (aiReview?.issues?.some(i => i.severity === 'CRITICAL')) finalScore = Math.max(finalScore, FLOOR_AI_CRITICAL);
  if (seoResults.audit?.indexing?.robotsTxt?.adsBot?.allowed === false) finalScore = Math.max(finalScore, FLOOR_ADSBOT_BLOCKED);

  let level, color, label;
  // A page with no risk evidence now scores ~5-15 (it used to sit at 20-25 because trust
  // started at 50), so MEDIUM begins at 25: at least one material site-specific signal,
  // e.g. a weeks-old domain in an abused zone for a vertical that needs certification.
  if (finalScore >= 80) { level = "CRITICAL"; color = "#d50000"; label = t("Критический риск бана", "Critical ban risk"); }
  else if (finalScore >= 60) { level = "HIGH"; color = "#ff6d00"; label = t("Высокий риск", "High risk"); }
  else if (finalScore >= 25) { level = "MEDIUM"; color = "#ffb300"; label = t("Средний риск", "Medium risk"); }
  else { level = "LOW"; color = "#00c853"; label = t("Низкий риск", "Low risk"); }

  const topFactors = factors.map(f => ({ ...f, contribution: Math.round(f.score * f.weight) })).sort((a, b) => b.contribution - a.contribution);
  return { score: finalScore, level, color, label, factors, topFactors };
}

/**
 * 0 = every trust signal present. It used to start at 50, so a flawless page still scored
 * 50/100 here. Analytics isn't a Google Ads policy requirement — only a weak signal; the
 * destination-requirement / misrepresentation basics (HTTPS, contacts, privacy) weigh most.
 * Domain age lives in domainRiskScore().
 */
export function calculateSEORiskScore(seo) {
  let score = 0;
  if (!seo.ssl.hasSSL) score += 45;
  if (!seo.structure.hasContact) score += 15;
  if (!seo.structure.hasPrivacy) score += 15;
  if (!seo.structure.hasTerms) score += 5;
  if (!seo.analytics.found) score += 5;
  if ((seo.reverseIP?.riskAnalysis?.highRiskNeighbors || 0) > 0) score += 10;
  const audit = seo.audit;
  if (audit) {
    if (audit.indexing.robotsTxt.adsBot.allowed === false) score += 40;
    if (audit.indexing.canonicalOtherHost) score += 20;
    if (audit.structure.wordCount < 150) score += 15;
    if (audit.trust.issues.some(i => i.code === 'no_refund')) score += 10;
    if (audit.trust.issues.some(i => i.code === 'no_impressum')) score += 10;
    if (audit.trust.issues.some(i => i.code === 'no_consent_mode')) score += 5;
  }
  return Math.min(100, score);
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 7: RECOMMENDATION ENGINE
// ══════════════════════════════════════════════════════════════════════════════

const PRIORITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/**
 * Prioritised fix plan. Each item: { code, priority, section, title, text, example }.
 * `section` lets the UI link a fix to the report block it comes from.
 */
export function generateRecs(risk, textResults, seoResults, vertical, geo, impersonation = null, lang = 'ru') {
  const t = tr(lang);
  const recs = [];
  const add = (code, priority, section, title, text, example = '') => recs.push({ code, priority, section, title, text, example });
  const geoData = getGeoRisk(geo, lang);
  const audit = seoResults.audit;
  const has = (code) => [...(audit?.trust.issues || []), ...(audit?.indexing.issues || []), ...(audit?.structure.issues || [])].some(i => i.code === code);

  // the score is a heuristic index, not a calibrated probability — don't present it as one
  if (risk.score >= 80) add('stop_launch', 'CRITICAL', 'overview',
    t('Остановить запуск до исправлений', 'Hold the launch until fixed'),
    t(`Риск-индекс ${risk.score}/100 — критический уровень: найдены признаки, за которые Google блокирует без предупреждения.`,
      `Risk index ${risk.score}/100 is critical: signals Google suspends for without warning were found.`),
    t('Сначала закройте все пункты CRITICAL и HIGH ниже.', 'Close every CRITICAL and HIGH item below first.'));
  if (impersonation?.isLikely) add('impersonation', 'CRITICAL', 'domain',
    t(`Домен похож на чужой бренд${impersonation.brand ? ` (${impersonation.brand})` : ''}`, `Domain looks like someone else's brand${impersonation.brand ? ` (${impersonation.brand})` : ''}`),
    t(`${impersonation.reason || 'Домен или страница выдают себя за другой бренд.'} Имперсонация — «Недобросовестная деловая практика»: аккаунт блокируется сразу, без предупреждения.`,
      `${impersonation.reason || 'The domain or page poses as another brand.'} Impersonation is an "Unacceptable business practice": the account is suspended immediately, without warning.`),
    t('Используйте собственный бренд и домен без отсылок к чужим торговым маркам.', 'Use your own brand and a domain without references to other trademarks.'));
  else if (impersonation?.kind === 'brand_mention') add('brand_mention', 'HIGH', 'domain',
    t(`Чужой бренд в домене: ${impersonation.brand}`, `Third-party brand in the domain: ${impersonation.brand}`),
    t(`${impersonation.reason} Без авторизации правообладателя это риск жалобы на товарный знак и проверки на имперсонацию.`,
      `${impersonation.reason} Without the owner's authorisation this risks a trademark complaint and an impersonation review.`),
    t('Уберите чужую марку из домена или подготовьте подтверждение статуса официального реселлера.', 'Remove the trademark from the domain or prepare proof of authorised-reseller status.'));

  const criticalIssues = textResults.issues.filter(i => i.severity === 'CRITICAL' && !i.falsePositive);
  const highIssues = textResults.issues.filter(i => i.severity === 'HIGH' && !i.falsePositive);
  if (criticalIssues.length) add('critical_triggers', 'CRITICAL', 'content',
    t(`Удалить критичные фразы (${criticalIssues.length})`, `Remove critical phrases (${criticalIssues.length})`),
    t(`На странице: ${criticalIssues.slice(0, 3).map(i => `«${i.text}»`).join(', ')}.`, `On the page: ${criticalIssues.slice(0, 3).map(i => `"${i.text}"`).join(', ')}.`),
    t('Замените на нейтральные формулировки без обещаний и обхода правил.', 'Replace with neutral wording without promises or rule-bending.'));
  if (highIssues.length) add('high_triggers', 'HIGH', 'content',
    t(`Заменить рискованные фразы (${highIssues.length})`, `Replace risky phrases (${highIssues.length})`),
    t(`На странице: ${highIssues.slice(0, 3).map(i => `«${i.text}»`).join(', ')}.`, `On the page: ${highIssues.slice(0, 3).map(i => `"${i.text}"`).join(', ')}.`),
    t('Например: «чудо-средство» → «поддержка самочувствия».', 'E.g. "miracle cure" → "wellness support".'));
  if (!seoResults.ssl.hasSSL) add('no_ssl', 'CRITICAL', 'trust',
    t('Установить SSL / HTTPS', 'Install SSL / HTTPS'),
    t('Сайт без HTTPS — мгновенный отказ модерации.', 'A site without HTTPS is rejected by moderation right away.'),
    'sudo certbot --nginx -d yourdomain.com');
  if (audit?.indexing.robotsTxt.adsBot.allowed === false) add('adsbot_blocked', 'CRITICAL', 'indexing',
    t('Открыть сайт для AdsBot-Google', 'Allow AdsBot-Google'),
    t(`robots.txt закрывает страницу от AdsBot-Google (${audit.indexing.robotsTxt.adsBot.rule}) — объявления отклонят как «Destination not crawlable».`,
      `robots.txt blocks AdsBot-Google (${audit.indexing.robotsTxt.adsBot.rule}) — ads will be disapproved as "Destination not crawlable".`),
    'User-agent: AdsBot-Google\nAllow: /');
  if (has('canonical_other_host')) add('canonical_other_host', 'HIGH', 'indexing',
    t('Исправить canonical', 'Fix the canonical tag'),
    t(`Canonical ведёт на другой домен (${audit.indexing.canonical}) — страница выглядит как копия чужого сайта.`, `Canonical points to another domain (${audit.indexing.canonical}) — the page looks like a copy.`),
    t('<link rel="canonical" href="https://ваш-домен/">', '<link rel="canonical" href="https://your-domain/">'));
  if (!seoResults.structure.hasPrivacy) add('no_privacy', 'HIGH', 'trust',
    t('Добавить Privacy Policy', 'Add a Privacy Policy'),
    t('Нужна, если сайт собирает любые данные (формы, пиксели, аналитика). Ссылка — в футере каждой страницы.', 'Required whenever the site collects any data (forms, pixels, analytics). Link it in the footer of every page.'),
    t('Генераторы: termsfeed.com, iubenda.com', 'Generators: termsfeed.com, iubenda.com'));
  if (!seoResults.structure.hasContact) add('no_contacts', 'HIGH', 'trust',
    t('Добавить контакты', 'Add contact details'),
    t('Модерация проверяет, что за сайтом стоит реальный бизнес: email на своём домене, телефон, адрес, форма связи.', 'Reviewers check that a real business stands behind the site: an email on your domain, phone, address, contact form.'),
    t('Блок контактов в футере + отдельная страница /contact.', 'Contacts in the footer + a dedicated /contact page.'));
  if (has('no_impressum')) add('no_impressum', 'HIGH', 'trust',
    t('Добавить Impressum', 'Add an Impressum'),
    t(`Для ${geo} обязательна страница с юр. данными: название компании, адрес, контакты, регистрационный номер.`, `${geo} requires a page with legal details: company name, address, contacts, registration number.`),
    t('Ссылка «Impressum» в футере каждой страницы.', 'An "Impressum" link in every page footer.'));
  if (has('no_refund')) add('no_refund', 'HIGH', 'trust',
    t('Добавить политику возврата и доставки', 'Add a refund & shipping policy'),
    t('Для продаж условия возврата, доставки и полная цена должны быть доступны до оплаты — иначе Misrepresentation.', 'For sales, return and shipping terms and the full price must be visible before payment — otherwise Misrepresentation.'),
    t('Страница /refund-policy + ссылка в футере и в оформлении заказа.', 'A /refund-policy page linked in the footer and at checkout.'));
  if (has('thin_content')) add('thin_content', 'HIGH', 'structure',
    t('Добавить содержательный текст', 'Add substantial content'),
    t(`На странице ${audit.structure.wordCount} слов. Нужен понятный оффер, описание компании, условия и ответы на вопросы.`, `The page has ${audit.structure.wordCount} words. It needs a clear offer, company info, terms and FAQs.`),
    t('Ориентир — от 300 слов уникального текста.', 'Aim for 300+ words of original text.'));
  if (has('no_terms')) add('no_terms', 'MEDIUM', 'trust',
    t('Добавить условия использования', 'Add Terms of Service'),
    t('Оферта / Terms показывают модерации, на каких условиях продаётся продукт.', 'Terms show reviewers on what conditions the product is sold.'));
  if (has('no_cookies') || has('no_consent_mode')) add('consent', has('no_consent_mode') ? 'MEDIUM' : 'LOW', 'trust',
    t('Баннер согласия на cookie и Consent Mode v2', 'Cookie consent banner and Consent Mode v2'),
    t('Для трафика из ЕЭЗ, Великобритании и Швейцарии Google требует передавать согласие пользователя (EU user consent policy).', 'For traffic from the EEA, UK and Switzerland Google requires passing user consent (EU user consent policy).'),
    t('CMP из Google CMP Partner Program (Cookiebot, CookieYes, Usercentrics) с включённым Consent Mode v2.', 'A CMP from the Google CMP Partner Program (Cookiebot, CookieYes, Usercentrics) with Consent Mode v2 enabled.'));
  if (has('no_viewport')) add('no_viewport', 'MEDIUM', 'structure',
    t('Сделать мобильную версию', 'Make the page mobile-friendly'),
    t('Нет meta viewport — на телефоне страница отображается как десктопная.', 'No meta viewport — the page renders as desktop on phones.'),
    '<meta name="viewport" content="width=device-width, initial-scale=1">');
  if (textResults.uniqueness?.score != null && textResults.uniqueness.score < 50) add('rewrite_content', 'HIGH', 'content',
    t('Переписать шаблонный текст', 'Rewrite template text'),
    t(`Уникальность ${textResults.uniqueness.score}%: на странице placeholder или шаблонные фразы.`, `Uniqueness ${textResults.uniqueness.score}%: the page has placeholder or template text.`));
  if (seoResults.speed?.mobileScore != null && seoResults.speed.mobileScore < 50) add('speed', 'MEDIUM', 'speed',
    t('Ускорить мобильную версию', 'Speed up the mobile page'),
    t(`PageSpeed mobile ${seoResults.speed.mobileScore}/100. Медленная страница — плохой Landing page experience и дороже клик.`, `PageSpeed mobile ${seoResults.speed.mobileScore}/100. A slow page hurts landing page experience and raises CPC.`),
    t('Сжать изображения (WebP), lazy loading, CDN.', 'Compress images (WebP), lazy loading, CDN.'));
  if (seoResults.whois.domainAge != null && seoResults.whois.domainAge < 90) add('young_domain', 'MEDIUM', 'domain',
    t('Учесть молодой домен', 'Account for the young domain'),
    t(`Домену ${seoResults.whois.domainAge} дн. Свежие домены проходят усиленную проверку.`, `The domain is ${seoResults.whois.domainAge} days old. Fresh domains get enhanced review.`),
    t('Начинайте с небольших бюджетов и белого контента, либо используйте домен с историей.', 'Start with small budgets and white content, or use a domain with history.'));
  if (seoResults.social.found.length === 0) add('no_social', 'LOW', 'trust',
    t('Добавить ссылки на соцсети', 'Link your social profiles'),
    t('Живые профили компании — дополнительный сигнал доверия при ручной проверке.', 'Real company profiles are an extra trust signal in manual review.'));
  if (!seoResults.analytics.found) add('no_analytics', 'LOW', 'trust',
    t('Подключить Google-тег / GA4', 'Install the Google tag / GA4'),
    t('Не требование политик, но без тега не будет конверсий и автостратегий.', 'Not a policy requirement, but without the tag there are no conversions or smart bidding.'));
  if (geoData.tier === 1) add('tier1_geo', 'LOW', 'overview',
    t(`${geoData.name}: Tier 1 GEO`, `${geoData.name}: Tier 1 GEO`),
    geoData.explain,
    t('Подготовьте лицензии и сертификации до запуска.', 'Prepare licences and certifications before launch.'));
  return recs.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}


// ══════════════════════════════════════════════════════════════════════════════
