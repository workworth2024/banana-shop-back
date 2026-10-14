/**
 * SEO / Trust-signal analyzer — parses HTML for analytics, social links,
 * SSL/HSTS hints and page structure. Ported from
 * policy-scanner-v3/scanner-engine.js (PART 4), with the simulated
 * speed/WHOIS sections removed in favour of real API calls (see index.js).
 */

// PART 4: SEO / TRUST ANALYZER
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Social media platform detection patterns.
 */
// Domain match anchored at a host boundary, so "x.com" doesn't fire on "fax.com"/"box.com"
// and "t.co" doesn't fire on every "*t.com". Non-global on purpose: a /g regex keeps
// lastIndex between .test() calls, and these module-level regexes are shared by all scans.
const host = (src) => new RegExp(`(?<![\\w.-])(?:www\\.)?${src}(?![\\w-])`, 'i');

export const SOCIAL_PATTERNS = {
  facebook:   { name: "Facebook",   patterns: [host('facebook\\.com(?!/tr)'), host('fb\\.com'), host('fb\\.me')],                 icon: "📘" },
  instagram:  { name: "Instagram",  patterns: [host('instagram\\.com'), host('instagr\\.am')],                                   icon: "📸" },
  twitter:    { name: "Twitter / X",  patterns: [host('twitter\\.com'), host('x\\.com'), host('t\\.co/')],                       icon: "🐦" },
  telegram:   { name: "Telegram",   patterns: [host('t\\.me/'), host('telegram\\.me'), /tg:\/\//i],                               icon: "✈️" },
  whatsapp:   { name: "WhatsApp",   patterns: [host('wa\\.me'), host('whatsapp\\.com'), host('api\\.whatsapp\\.com')],           icon: "💬" },
  youtube:    { name: "YouTube",    patterns: [host('youtube\\.com'), host('youtu\\.be'), host('youtube-nocookie\\.com')],        icon: "▶️" },
  tiktok:     { name: "TikTok",     patterns: [host('tiktok\\.com/@'), host('vm\\.tiktok\\.com')],                               icon: "🎵" },
  linkedin:   { name: "LinkedIn",   patterns: [host('linkedin\\.com'), host('linked\\.in')],                                    icon: "💼" },
  discord:    { name: "Discord",    patterns: [host('discord\\.gg'), host('discord\\.com/invite')],                              icon: "🎮" },
  reddit:     { name: "Reddit",     patterns: [host('reddit\\.com/(?:r|u|user)/'), host('redd\\.it')],                          icon: "🔴" },
  pinterest:  { name: "Pinterest",  patterns: [host('pinterest\\.com'), host('pin\\.it')],                                      icon: "📌" },
  snapchat:   { name: "Snapchat",   patterns: [host('snapchat\\.com/add')],                                                    icon: "👻" },
  trustpilot: { name: "Trustpilot", patterns: [host('trustpilot\\.com/review')],                                               icon: "⭐" },
};

/**
 * Tracking pixel / analytics detection patterns.
 * Each entry: name, regex patterns (with capture groups for ID extraction), icon.
 *
 * TODO BACKEND: Verify trackers are actually firing (not just present in code)
 * TODO BACKEND: Add server-side tracking detection (GTM SS, FB CAPI)
 */
export const TRACKING_PATTERNS = {
  // GA4 / GTM ids are upper-case by spec — case-insensitive matching fired on CSS classes like "img-container1"
  ga4:            { name: "Google Analytics 4",  patterns: [/gtag\(\s*['"]config['"],\s*['"](G-[A-Z0-9]{8,12})['"]/, /(?<![\w-])(G-[A-Z0-9]{8,12})(?![\w-])/],      icon: "📊" },
  gtm:            { name: "Google Tag Manager",  patterns: [/googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]{4,8})/, /(?<![\w-])(GTM-[A-Z0-9]{4,8})(?![\w-])/],     icon: "🏷️" },
  fb_pixel:       { name: "Facebook Pixel",      patterns: [/connect\.facebook\.net\/[^"']*fbevents\.js/gi, /facebook\.com\/tr/gi, /fbq\s*\(/gi],                    icon: "👤" },
  fb_capi:        { name: "Facebook CAPI",       patterns: [/ConversionsAPI/gi, /capi.*facebook/gi],                                                            icon: "📡" },
  yandex_metrika: { name: "Yandex Metrika",      patterns: [/mc\.yandex\.ru\/watch\/(\d+)/gi, /ym\((\d+),\s*['"]init['"]/gi, /mc\.yandex\.ru\/metrika\/tag\.js\?id=(\d+)/gi], icon: "🟡" },
  tiktok_pixel:   { name: "TikTok Pixel",        patterns: [/analytics\.tiktok\.com/gi, /ttq\s*\(/gi],                                                              icon: "🎵" },
  hotjar:         { name: "Hotjar",              patterns: [/hotjar\.com/gi, /hjScript/gi, /hj\.js/gi],                                                             icon: "🔥" },
  clarity:        { name: "Microsoft Clarity",   patterns: [/clarity\.ms\/tag/gi, /clarity\.js/gi],                                                                icon: "🪟" },
  amplitude:      { name: "Amplitude",           patterns: [/amplitude\.com/gi, /amplitude\.js/gi],                                                                 icon: "📈" },
  segment:        { name: "Segment.io",          patterns: [/cdn\.segment\.com/gi, /segment\.io/gi],                                                              icon: "🔄" },
};

/**
 * SEO and Trust Signal Analyzer.
 * Parses HTML source to detect analytics, social, SSL, structure.
 *
 * @param {string} url — page URL
 * @param {string} text — full HTML source
 * @param {string} headline — ad headline
 * @param {string} description — ad description
 * @returns {object} full SEO analysis results
 *
 * TODO BACKEND: Replace simulation with real API calls:
 *   - PageSpeed Insights API (real Core Web Vitals)
 *   - WHOIS XML API (real domain age, registrar)
 *   - SSL Labs API (real TLS grade A+ - F)
 *   - Security Headers API (real header checks)
 *   - Schema.org validation (Google Rich Results Test)
 */
export function analyzeSEO(url, text, headline, description) {
  const combined = [text, headline, description].filter(Boolean).join(" ");
  const lowerCombined = combined.toLowerCase();
  const results = {
    analytics: { found: false, type: null, details: [] },
    social: { found: [], notFound: Object.keys(SOCIAL_PATTERNS), details: [] },
    tracking: { found: [], details: [] },
    ssl: { hasSSL: false, tlsVersion: null, certAge: null, sharedHosting: false, sanCount: 1, issues: [] },
    structure: { title: null, metaDescription: null, hasTitle: false, hasMetaDescription: false, hasH1: false, hasContact: false, hasAbout: false, hasPrivacy: false, hasTerms: false, hasCookiePolicy: false, hasTelegram: false, hasYouTube: false, hreflang: [], wordCount: 0 },
    speed: { mobileScore: 0, desktopScore: 0, loadTime: 0, size: 0, details: [] },
    whois: { domainAge: 0, registrar: null, hosting: null, ip: null, country: null, asn: null, reverseDns: null, issues: [] },
  };

  // ── 1. Tracking & Analytics ──
  const foundIds = {};
  for (const [key, tracker] of Object.entries(TRACKING_PATTERNS)) {
    let found = false;
    let extractedId = null;
    for (const pattern of tracker.patterns) {
      const patternCopy = new RegExp(pattern.source, pattern.flags.replace('g', ''));
      const execResult = patternCopy.exec(combined);
      if (execResult) { found = true; if (execResult[1]) extractedId = execResult[1]; break; }
    }
    // Yandex fallback ID extraction
    if (found && key === 'yandex_metrika' && !extractedId) {
      const watchMatch = /mc\.yandex\.ru\/watch\/(\d+)/.exec(combined);
      if (watchMatch) extractedId = watchMatch[1];
      else { const ymMatch = /ym\((\d+),\s*['"]init['"]/.exec(combined); if (ymMatch) extractedId = ymMatch[1]; }
    }
    if (found) {
      const entry = { key, name: tracker.name, icon: tracker.icon };
      if (extractedId) { entry.id = extractedId; foundIds[key] = extractedId; }
      results.tracking.found.push(entry);
      if (key === 'ga4' || key === 'gtm') { results.analytics.found = true; results.analytics.type = tracker.name + (extractedId ? ` (${extractedId})` : ''); }
    }
  }

  if (!results.analytics.found) {
    results.analytics.details.push("Google Analytics 4 не обнаружен — нет gtag() или G-XXXXXXXXXX");
    results.analytics.details.push("Google Tag Manager не обнаружен — нет GTM-XXXXXX");
    results.analytics.details.push("Без аналитики невозможно отслеживать конверсии и оптимизировать кампании");
  } else {
    const ids = Object.entries(foundIds).map(([k,v]) => v).filter(Boolean);
    results.analytics.details.push(`✅ Аналитика обнаружена: ${ids.join(', ')}`);
  }

  // ── 2. Social Media ──
  for (const [key, social] of Object.entries(SOCIAL_PATTERNS)) {
    for (const pattern of social.patterns) {
      if (pattern.test(combined)) {
        if (!results.social.found.find(f => f.key === key)) {
          results.social.found.push({ key, name: social.name, icon: social.icon });
        }
        results.social.notFound = results.social.notFound.filter(k => k !== key);
        break;
      }
    }
  }
  // Telegram/YouTube extra detection
  if (/t\.me\//i.test(combined) && !results.social.found.find(f => f.key === 'telegram')) {
    results.social.found.push({ key: 'telegram', name: 'Telegram', icon: '✈️' });
    results.social.notFound = results.social.notFound.filter(k => k !== 'telegram');
  }
  if (/youtube\.com/i.test(combined) && !results.social.found.find(f => f.key === 'youtube')) {
    results.social.found.push({ key: 'youtube', name: 'YouTube', icon: '▶️' });
    results.social.notFound = results.social.notFound.filter(k => k !== 'youtube');
  }

  // ── 3. SSL / HTTPS / HSTS detection ──
  const hasHttpsUrl = url && url.startsWith("https://");
  const hasHSTS = /<meta[^>]*http-equiv=["']strict-transport-security["']/i.test(combined);
  const canonicalHttps = /<link[^>]*rel=["']canonical["'][^>]*href=["']https:/i.test(combined);
  const ogUrlHttps = /<meta[^>]*property=["']og:url["'][^>]*content=["']https:/i.test(combined);
  const hasUpgradeInsecure = /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*upgrade-insecure-requests/i.test(combined);

  if (hasHttpsUrl || hasHSTS || canonicalHttps || ogUrlHttps) {
    // TLS version / certificate age / SAN count aren't measured here (the old demo engine
    // made them up: hard-coded "TLS 1.3", random cert age) — left null/default on purpose.
    results.ssl.hasSSL = true;
    if (hasHSTS) results.ssl.issues.push("✅ HSTS обнаружен — Chrome автоматически открывает сайт по HTTPS.");
    if (canonicalHttps) results.ssl.issues.push("✅ Canonical URL использует HTTPS.");
    if (hasUpgradeInsecure) results.ssl.issues.push("✅ CSP upgrade-insecure-requests — браузер апгрейдит HTTP до HTTPS.");
    if (!hasHttpsUrl && (hasHSTS || canonicalHttps || ogUrlHttps)) {
      results.ssl.issues.push("⚠️ URL введён с http://, но сайт имеет HTTPS-защиту.");
    }
    if (results.ssl.sharedHosting) {
      results.ssl.issues.push(`Shared hosting: ${results.ssl.sanCount} доменов на одном SSL-сертификате.`);
    }
  } else if (url && url.startsWith("http://")) {
    results.ssl.hasSSL = false;
    results.ssl.issues.push("❌ Сайт использует HTTP без HTTPS — Google Chrome помечает как «Not Secure».");
  } else {
    results.ssl.hasSSL = false;
    results.ssl.issues.push("❌ HTTPS не обнаружен.");
  }

  // ── 4. Page structure (parse from real HTML) ──
  const titleMatch = combined.match(/<title[^>]*>([^<]*)<\/title>/i);
  const metaDescMatch = combined.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
                     || combined.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const h1Match = combined.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  const hreflangMatches = combined.match(/<link[^>]*hreflang=["']([^"']*)["']/gi);

  results.structure.title = titleMatch ? titleMatch[1].trim() : null;
  results.structure.metaDescription = metaDescMatch ? metaDescMatch[1].trim() : null;
  results.structure.hasTitle = !!(results.structure.title && results.structure.title.length > 3);
  results.structure.hasMetaDescription = !!(results.structure.metaDescription && results.structure.metaDescription.length > 5);
  results.structure.hasH1 = !!(h1Match && h1Match[1].trim().length > 0);
  // Trust pages are judged on what a visitor/reviewer sees (visible text + link targets), not on
  // raw HTML: inline JS/CSS almost always contains "email", "help", "privacy", "tos" (photos,
  // toString…), which made these checks pass on nearly every page.
  const visible = combined
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase();
  const hrefs = (combined.match(/href=["'][^"']*["']/gi) || []).join(' ').toLowerCase();
  results.structure.hasContact = /\b(contact|contacts|contact us|support)\b|связаться|свяжитесь|контакты|телефон|поддержка/.test(visible)
                              || /mailto:|tel:|contact/.test(hrefs);
  results.structure.hasAbout = /\b(about us|about|who we are|our story)\b|о нас|о компании/.test(visible) || /about/.test(hrefs);
  results.structure.hasPrivacy = /\bprivacy\b|конфиденциальност|\bgdpr\b/.test(visible) || /privacy|konfidenc|datenschutz/.test(hrefs);
  results.structure.hasTerms = /\b(terms|terms of service|terms and conditions|terms & conditions)\b|условия использования|пользовательское соглашение|оферт/.test(visible)
                            || /terms|\btos\b|oferta|agreement/.test(hrefs);
  results.structure.hasCookiePolicy = /\bcookies?\b|файлы cookie/.test(visible) || /cookie/.test(hrefs);
  results.structure.hasTelegram = /t\.me\//i.test(combined) || /telegram/i.test(lowerCombined);
  results.structure.hasYouTube = /youtube\.com/i.test(combined) || /youtu\.be/i.test(combined);
  results.structure.hreflang = hreflangMatches ? hreflangMatches.map(m => m.match(/hreflang=["']([^"']*)["']/i)?.[1]).filter(Boolean) : [];
  results.structure.wordCount = combined.split(/\s+/).filter(w => w.length > 0).length;


  // NOTE: speed (PageSpeed Insights) and whois/reverseIP (ViewDNS) are fetched
  // separately via real APIs in services/siteAnalyzer/index.js and merged into
  // `results.speed` / `results.whois` / `results.reverseIP` afterwards.
  return results;
}
