/**
 * Reverse-IP demo lookup, ML-style weighted risk predictor and the
 * recommendation engine. Ported from policy-scanner-v3/scanner-engine.js
 * (PARTS 5-7). `reverseIPLookup` here is a last-resort fallback used only
 * if the real ViewDNS API call fails — see viewDnsService.js for the
 * production path.
 */
import { VERTICAL_RISK, getGeoRisk } from './triggers.js';

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

export function reverseIPLookup(ip, hosting, url) {
  let provider = "unknown";
  if (hosting && hosting.includes("Cloudflare")) provider = "cloudflare";
  else if (hosting && hosting.includes("DigitalOcean")) provider = "digitalocean";
  else if (url && url.includes("cloudflare")) provider = "cloudflare";
  else if (url && url.includes("readcorner")) provider = "cloudflare";

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

/**
 * Predicts ban risk using 7 weighted factors with explainability.
 * TODO: Replace with trained XGBoost model on historical ban data.
 * TODO: Add SHAP values for per-feature contribution visualization.
 */
export function predictRisk(textResults, seoResults, vertical, geo) {
  const geoData = getGeoRisk(geo);
  const vertData = VERTICAL_RISK[vertical] || VERTICAL_RISK['general'];

  const factors = [
    { name: "Текстовые триггеры", score: Math.min(100, textResults.totalScore), weight: 0.30,
      explain: `Найдено ${textResults.issues.length} триггеров в ${textResults.categories.filter(c => c.score > 0).length} категориях.` },
    { name: "Вертикаль риска", score: vertData.base, weight: 0.25,
      explain: `Вертикаль «${vertData.label}» — базовый риск ${vertData.base}%.` },
    { name: "GEO-модерация", score: geoData.risk, weight: 0.18,
      explain: `${geoData.name} (Tier ${geoData.tier}): ${geoData.explain}` },
    { name: "SEO / Trust Signals", score: calculateSEORiskScore(seoResults), weight: 0.12,
      explain: seoResults.ssl.hasSSL ? `SSL: ${seoResults.ssl.tlsVersion || 'есть'}. Аналитика: ${seoResults.analytics.found ? '✅' : '❌'}. Privacy: ${seoResults.structure.hasPrivacy ? '✅' : '❌'}` : "Отсутствует HTTPS — критический минус." },
    { name: "Социальное доказательство", score: seoResults.social.found.length === 0 ? 60 : Math.max(0, 30 - seoResults.social.found.length * 5), weight: 0.07,
      explain: seoResults.social.found.length === 0 ? "Соцсети не обнаружены — повышает подозрительность." : `Найдены: ${seoResults.social.found.map(s => s.name).join(', ')}` },
    { name: "Уникальность контента", score: 100 - (textResults.uniqueness?.score || 50), weight: 0.05,
      explain: textResults.uniqueness ? `Уникальность: ${textResults.uniqueness.score}%` : "Не проверена." },
    { name: "Скорость загрузки", score: Math.max(0, 100 - (seoResults.speed?.mobileScore || 50)), weight: 0.03,
      explain: seoResults.speed ? `Mobile: ${seoResults.speed.mobileScore}/100 (${seoResults.speed.loadTime}s)` : "Не проверена." }
  ];

  let totalWeighted = 0, totalWeight = 0;
  factors.forEach(f => { totalWeighted += f.score * f.weight; totalWeight += f.weight; });
  const finalScore = Math.round(totalWeighted / totalWeight);

  let level, color, label;
  if (finalScore >= 80) { level = "CRITICAL"; color = "#d50000"; label = "Критический риск бана"; }
  else if (finalScore >= 60) { level = "HIGH"; color = "#ff6d00"; label = "Высокий риск"; }
  else if (finalScore >= 35) { level = "MEDIUM"; color = "#ffb300"; label = "Средний риск"; }
  else { level = "LOW"; color = "#00c853"; label = "Низкий риск"; }

  const topFactors = factors.map(f => ({ ...f, contribution: Math.round(f.score * f.weight) })).sort((a, b) => b.contribution - a.contribution);
  return { score: finalScore, level, color, label, factors, topFactors };
}

export function calculateSEORiskScore(seo) {
  let score = 50;
  if (!seo.ssl.hasSSL) score += 40;
  else if (seo.ssl.sharedHosting) score += 10;
  if (!seo.analytics.found) score += 15;
  if (!seo.structure.hasContact) score += 15;
  if (!seo.structure.hasPrivacy) score += 10;
  if (!seo.structure.hasTerms) score += 5;
  if (seo.whois.domainAge < 30) score += 20;
  else if (seo.whois.domainAge < 90) score += 10;
  return Math.min(100, score);
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 7: RECOMMENDATION ENGINE
// ══════════════════════════════════════════════════════════════════════════════

export function generateRecs(risk, textResults, seoResults, vertical, geo) {
  const recs = [];
  const geoData = getGeoRisk(geo);

  if (risk.score >= 80) {
    recs.push({ priority: "CRITICAL", title: "🚨 Остановить запуск до исправлений",
      text: `Риск бана ${risk.score}% — вероятность отклонения или бана превышает 80%.`, example: "Снизьте скор хотя бы до 60% — уберите CRITICAL/HIGH триггеры." });
  }

  const criticalIssues = textResults.issues.filter(i => i.severity === "CRITICAL");
  const highIssues = textResults.issues.filter(i => i.severity === "HIGH");
  if (criticalIssues.length > 0) {
    recs.push({ priority: "CRITICAL", title: `📝 Удалить ${criticalIssues.length} CRITICAL триггер(ов)`,
      text: `Паттерны: ${criticalIssues.slice(0, 3).map(i => `"${i.text}"`).join(', ')}.`, example: "Замените на policy-friendly альтернативы." });
  }
  if (highIssues.length > 0) {
    recs.push({ priority: "HIGH", title: `📝 Заменить ${highIssues.length} HIGH-риск фраз`,
      text: `Триггеры: ${highIssues.slice(0, 3).map(i => `"${i.text}"`).join(', ')}.`, example: " miracle cure → wellness support" });
  }
  if (!seoResults.ssl.hasSSL) {
    recs.push({ priority: "CRITICAL", title: "🔒 Установить SSL / HTTPS",
      text: "Сайт без HTTPS — мгновенный отказ модерации.", example: "Certbot: sudo certbot --nginx -d yourdomain.com" });
  }
  if (seoResults.ssl.sharedHosting) {
    recs.push({ priority: "MEDIUM", title: "🖥️ Выделенный IP / VPS",
      text: `Shared hosting с ${seoResults.ssl.sanCount} доменами. Риск «плохих соседей».`, example: "DigitalOcean, Vultr — $5-20/мес." });
  }
  if (!seoResults.analytics.found) {
    recs.push({ priority: "HIGH", title: "📊 Установить GA4 + GTM",
      text: "GA4 отсутствует — невозможно отслеживать конверсии.", example: "Создайте GA4 property → добавьте G-XXXXXXXX в <head>" });
  }
  if (seoResults.social.found.length === 0) {
    recs.push({ priority: "MEDIUM", title: "👥 Добавить социальные сети",
      text: "Social proof — фактор траста для manual review.", example: "Facebook Business Page + Instagram (бесплатно)" });
  }
  if (!seoResults.structure.hasContact) {
    recs.push({ priority: "HIGH", title: "📞 Добавить контактную информацию",
      text: "Отсутствует контактная информация — обязательный фактор траста.", example: "Email, phone, address, contact form" });
  }
  if (!seoResults.structure.hasPrivacy) {
    recs.push({ priority: "MEDIUM", title: "📄 Добавить Privacy Policy",
      text: "Privacy Policy обязательна для GDPR/CCPA compliance.", example: "iubenda.com, termsfeed.com — $10-30/год" });
  }
  if (textResults.uniqueness && textResults.uniqueness.score < 50) {
    recs.push({ priority: "HIGH", title: "✍️ Переписать контент",
      text: `Уникальность: ${textResults.uniqueness.score}%. Обнаружен placeholder/шаблонный текст.`, example: "Наймите копирайтера или используйте AI (Claude, GPT-4)" });
  }
  if (seoResults.speed && seoResults.speed.mobileScore < 50) {
    recs.push({ priority: "MEDIUM", title: "⚡ Оптимизировать скорость",
      text: `Mobile: ${seoResults.speed.mobileScore}/100 (${seoResults.speed.loadTime}s).`, example: "Сжать изображения (TinyPNG) → Lazy loading → CDN (Cloudflare)" });
  }
  if (seoResults.whois.domainAge < 90) {
    recs.push({ priority: "MEDIUM", title: "📅 Домен молодой",
      text: `Домену ${seoResults.whois.domainAge} дней. Свежие домены получают enhanced review.`, example: "Используйте aged domain (Odys.global, SpamZilla)" });
  }
  if (geoData.tier === 1) {
    recs.push({ priority: "MEDIUM", title: `🌍 GEO ${geoData.name} — Tier 1`,
      text: geoData.explain, example: "Используйте certified accounts, подготовьте лицензии ДО запуска." });
  }
  return recs;
}


// ══════════════════════════════════════════════════════════════════════════════
