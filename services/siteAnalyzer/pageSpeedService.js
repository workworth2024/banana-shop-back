/**
 * Google PageSpeed Insights API — real Core Web Vitals, replacing the
 * simulated `speed` block from the original scanner-engine.js.
 * Docs: https://developers.google.com/speed/docs/insights/v5/get-started
 */
const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PSI_TIMEOUT_MS = 20000;

function emptySpeed(reason) {
  return {
    mobileScore: null,
    desktopScore: null,
    loadTime: null,
    size: null,
    details: [reason],
    coreWebVitals: null,
    source: 'unavailable'
  };
}

async function runOnce(url, strategy, apiKey) {
  const params = new URLSearchParams({ url, strategy, category: 'performance', key: apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PSI_TIMEOUT_MS);
  try {
    const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, { signal: controller.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      throw new Error(data?.error?.message || `PageSpeed API HTTP ${res.status}`);
    }
    const perfScore = data?.lighthouseResult?.categories?.performance?.score;
    const audits = data?.lighthouseResult?.audits || {};
    const metrics = data?.loadingExperience?.metrics || {};
    return {
      score: perfScore != null ? Math.round(perfScore * 100) : null,
      loadTimeSec: audits?.['speed-index']?.numericValue ? +(audits['speed-index'].numericValue / 1000).toFixed(2) : null,
      lcp: metrics?.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? audits?.['largest-contentful-paint']?.numericValue ?? null,
      cls: metrics?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile ?? audits?.['cumulative-layout-shift']?.numericValue ?? null,
      fcp: audits?.['first-contentful-paint']?.numericValue ?? null,
      tbt: audits?.['total-blocking-time']?.numericValue ?? null,
      opportunities: Object.values(audits)
        .filter(a => a.score !== null && a.score < 0.9 && a.details?.type === 'opportunity')
        .slice(0, 5)
        .map(a => ({ title: a.title, savingsMs: a.details?.overallSavingsMs || 0 }))
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getPageSpeed(url) {
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (!apiKey) return emptySpeed('PAGESPEED_API_KEY не настроен на сервере — скорость не проверена.');

  try {
    const [mobile, desktop] = await Promise.all([
      runOnce(url, 'mobile', apiKey),
      runOnce(url, 'desktop', apiKey).catch(() => null)
    ]);

    const details = [];
    if (mobile.score != null && mobile.score < 50) {
      details.push(`Mobile score ${mobile.score}/100 — критически медленно. Google Ads учитывает PageSpeed как фактор качества.`);
    }

    return {
      mobileScore: mobile.score,
      desktopScore: desktop?.score ?? null,
      loadTime: mobile.loadTimeSec,
      size: null,
      details,
      coreWebVitals: { lcp: mobile.lcp, cls: mobile.cls, fcp: mobile.fcp, tbt: mobile.tbt },
      opportunities: mobile.opportunities,
      source: 'pagespeed-insights'
    };
  } catch (e) {
    console.error('[PageSpeed] error:', e.message);
    return emptySpeed(`Не удалось получить данные PageSpeed Insights: ${e.message}`);
  }
}
