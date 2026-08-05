import { fetchHtml, normalizeUrl } from './htmlFetcher.js';
import { analyzeText, checkUniqueness } from './textAnalyzer.js';
import { analyzeSEO } from './seoAnalyzer.js';
import { predictRisk, generateRecs, reverseIPLookup } from './riskPredictor.js';
import { getPageSpeed } from './pageSpeedService.js';
import { resolveIp, reverseIpLookup, whoisLookup } from './viewDnsService.js';
import { analyzeComplianceContext, generateBanRiskNarrative } from './aimlApiService.js';
import { VERTICAL_RISK } from './triggers.js';

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Runs a full site scan: fetch HTML, local heuristics (triggers/SEO/uniqueness),
 * real PageSpeed + ViewDNS API calls, and AIMLAPI-powered contextual/ban-risk analysis.
 */
export async function runSiteScan({ url, vertical = 'general', geo = 'US' }) {
  const normalizedUrl = normalizeUrl(url);
  const verticalKey = VERTICAL_RISK[vertical] ? vertical : 'general';
  const geoKey = /^[A-Za-z]{2}$/.test(String(geo || '')) ? String(geo).toUpperCase() : 'US';

  const { html, finalUrl } = await fetchHtml(normalizedUrl);
  const bodyText = stripHtmlToText(html);

  const textResults = analyzeText(bodyText, '', '', '');
  textResults.uniqueness = checkUniqueness(bodyText);

  const seoResults = analyzeSEO(finalUrl, html, '', '');

  const hostname = new URL(finalUrl).hostname;
  const [speed, ip] = await Promise.all([
    getPageSpeed(finalUrl),
    resolveIp(hostname)
  ]);
  seoResults.speed = speed;

  const [whois, reverseIp] = await Promise.all([
    whoisLookup(hostname),
    ip ? reverseIpLookup(ip) : Promise.resolve(null)
  ]);

  seoResults.whois = {
    domainAge: whois.domainAge,
    registrar: whois.registrar,
    hosting: reverseIp?.isShared ? 'Shared hosting' : 'Dedicated / unknown',
    ip,
    country: null,
    asn: null,
    reverseDns: hostname,
    issues: [
      ...(whois.domainAge != null && whois.domainAge < 90
        ? [`Домен создан ${whois.domainAge} дней назад. Свежие домены (< 90 дней) получают повышенное внимание модерации.`]
        : []),
      ...(reverseIp?.isShared ? ['Shared hosting — IP используется несколькими доменами. Риск «плохих соседей».'] : []),
      ...(whois.source === 'unavailable' ? ['WHOIS недоступен (ViewDNS API не настроен или лимит исчерпан).'] : [])
    ]
  };
  seoResults.reverseIP = reverseIp || reverseIPLookup(ip, seoResults.whois.hosting, finalUrl);

  const risk = predictRisk(textResults, seoResults, verticalKey, geoKey);
  const recs = generateRecs(risk, textResults, seoResults, verticalKey, geoKey);

  const aiCompliance = await analyzeComplianceContext({
    url: finalUrl,
    vertical: verticalKey,
    textExcerpt: bodyText,
    triggerIssues: textResults.issues
  });

  const narrative = await generateBanRiskNarrative({
    url: finalUrl,
    vertical: verticalKey,
    geo: geoKey,
    riskScore: risk.score,
    riskLevel: risk.level,
    topFactors: risk.topFactors,
    aiCompliance
  });

  return {
    url: finalUrl,
    vertical: verticalKey,
    geo: geoKey,
    scannedAt: new Date().toISOString(),
    text: textResults,
    seo: seoResults,
    risk,
    recommendations: recs,
    ai: {
      compliance: aiCompliance,
      banRiskNarrative: narrative
    }
  };
}
