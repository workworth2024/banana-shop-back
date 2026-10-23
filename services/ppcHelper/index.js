/**
 * PPC Helper (Keyword Engine v2 integrated into Banana Traff): build orchestration, background jobs
 * and the public DTO. Pipeline (ported from keyword-engine-v2-new/server/routers.ts):
 *   build:   landing audit (optional URL) → local semantic core → Google Ads metrics
 *   jobs:    metrics refresh · paid SERP check · AI keyword expansion · AI RSA drafts
 * Every step that calls a paid API is capped per build (JOB_LIMITS) on top of the daily build quota.
 * Provider names, costs, raw errors, locale codes and search ids never leave the server.
 */
import PpcBuild from '../../models/PpcBuild.js';
import { refundPpcCredit } from '../../utils/ppcCredits.js';
import { UniversalKeywordEngine } from './engine.js';
import { auditLandingPage, emptyAudit } from './siteAudit.js';
import { getKeywordMetrics, metricsSafeKeyword, metricsConfigured, serpConfigured, runSerpSearch } from './providers.js';
import { expandAndReviewWithAI, generateAdVariantsWithAI, reviewNegativesWithAI, aiKey } from './ai.js';
import { refineNegatives } from './negatives.js';
import { GEO_OPTIONS, LANGUAGE_OPTIONS } from './geoLanguages.js';
import { registrable } from '../siteAnalyzer/lookalike.js';
import { tr } from '../siteAnalyzer/i18n.js';

export const VERTICALS = ['finance', 'gambling', 'nutra', 'sweeps', 'ecommerce', 'other'];
export const CLUSTERS = ['brand_own', 'brand_competitor', 'generic_commercial', 'product_niche', 'trust_reviews', 'info_discovery', 'negative_candidate'];
export const JOB_LIMITS = { metrics: 2, serp: 2, expand: 2, ads: 3 };
// hard ceiling on starts per job, refunded failures included (OWASP API4/API6: no endless free retries of paid calls)
export const JOB_ATTEMPTS = Object.fromEntries(Object.entries(JOB_LIMITS).map(([k, n]) => [k, n + 2]));
export const SERP_MAX_KEYWORDS = 10;
const SERP_CONCURRENCY = 4;
const STALE_MS = 6 * 60 * 1000;
const GEO_CODES = new Set(GEO_OPTIONS.map((g) => g.code));
const LANGUAGE_CODES = new Set(LANGUAGE_OPTIONS.map((l) => l.code));
const IGNORED_SERP_DOMAINS = new Set(['google.com', 'googleusercontent.com', 'gstatic.com', 'youtube.com', 'googleadservices.com']);

export const features = () => ({ metrics: metricsConfigured(), serp: serpConfigured(), ai: Boolean(aiKey()) });

// ------------------------------------------------------------------------------------------ input

const clean = (v, max) => String(v ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const splitList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[\n,;]+/));

/** Validates the build form. Returns { ok: true, offer } or { ok: false, field, message }. */
export function validateOffer(body, lang) {
  const t = tr(lang);
  const title = clean(body?.title, 120);
  if (!title || !/[\p{L}\p{N}]/u.test(title)) return { ok: false, field: 'title', message: t('Укажите название оффера или продукта', 'Enter the offer or product name') };
  const vertical = String(body?.vertical || '');
  if (!VERTICALS.includes(vertical)) return { ok: false, field: 'vertical', message: t('Выберите вертикаль', 'Choose a vertical') };
  const geoCountry = String(body?.geoCountry || '').toUpperCase();
  if (!GEO_CODES.has(geoCountry)) return { ok: false, field: 'geoCountry', message: t('Выберите страну', 'Choose a country') };
  const language = String(body?.language || '');
  if (!LANGUAGE_CODES.has(language)) return { ok: false, field: 'language', message: t('Выберите язык', 'Choose a language') };
  const rawDescription = String(body?.offerDescription ?? '');
  if (rawDescription.length > 5000) return { ok: false, field: 'offerDescription', message: t('Описание — не больше 5 000 символов', 'Description must be 5,000 characters or less') };
  const offerDescription = rawDescription.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  const keywords = Array.from(new Set(splitList(body?.keywords).map((k) => clean(k, 80).toLowerCase()).filter(Boolean)));
  if (keywords.length > 50) return { ok: false, field: 'keywords', message: t('Не больше 50 ключевых фраз', 'No more than 50 keyword phrases') };
  const tooLong = keywords.find((k) => k.split(' ').length > 10);
  if (tooLong) return { ok: false, field: 'keywords', message: t(`Фраза длиннее 10 слов: «${tooLong.slice(0, 40)}…» — Google Ads такие не принимает`, `A phrase is longer than 10 words: “${tooLong.slice(0, 40)}…” — Google Ads won't accept it`) };
  const competitorBrands = Array.from(new Set(splitList(body?.competitorBrands).map((k) => clean(k, 60)).filter(Boolean))).slice(0, 20);
  const landingUrl = clean(body?.landingUrl, 2000);
  // something to build from besides the name: own phrases or a page to read
  if (!keywords.length && !landingUrl) return { ok: false, field: 'keywords', message: t('Добавьте хотя бы одну ключевую фразу или URL лендинга', 'Add at least one keyword phrase or a landing page URL') };
  return {
    ok: true,
    offer: {
      title,
      offerDescription,
      landingUrl,
      vertical,
      geoCountry,
      language,
      keywords,
      targetAction: clean(body?.targetAction, 120) || 'Лид / Регистрация / Депозит',
      competitorBrands,
      useLiveApi: true
    }
  };
}

// ------------------------------------------------------------------------------------------ public DTO

const PUBLIC_AUDIT_FIELDS = ['checked', 'status', 'finalUrl', 'title', 'description', 'h1'];

function publicMetrics(m) {
  if (!m) return null;
  return {
    status: m.status,
    requestedCount: m.requestedCount || 0,
    matchedCount: m.matchedCount || 0,
    geoCountry: m.geoCountry,
    language: m.language,
    updatedAt: m.updatedAt
  };
}

function publicResearch(r) {
  return {
    keyword: r.keyword,
    status: r.status,
    adCount: r.adCount || 0,
    organicCount: r.organicCount || 0,
    localeVerified: r.localeVerified === true,
    ads: (r.ads || []).map(({ headline, description, displayUrl, sitelinks, position }) => ({ headline, description, displayUrl, sitelinks: sitelinks || [], position })),
    organic: (r.organic || []).map(({ title, description, url, displayUrl, position }) => ({ title, description, url, displayUrl, position }))
  };
}

function publicAi(ai) {
  if (!ai) return null;
  return {
    source: ai.source === 'ai' ? 'ai' : 'fallback',
    summary: ai.source === 'ai' ? clean(ai.summary, 600) : '',
    suggestions: (ai.suggestions || []).map(({ keyword, cluster, intent, policyRisk }) => ({ keyword, cluster, intent: clean(intent, 80), policyRisk })),
    negativeReviews: (ai.negativeReviews || []).map(({ term, scope, reason }) => ({ term: clean(term, 80), scope, reason: clean(reason, 240) })),
    adVariants: (ai.adVariants || []).map(({ angle, headlines, descriptions, policyRisk }) => ({ angle: clean(angle, 80), headlines, descriptions, policyRisk })),
    applied: ai.applied || []
  };
}

export function publicResult(result) {
  if (!result) return null;
  const audit = result.siteAudit || {};
  return {
    offer: {
      title: result.offer.title,
      offerDescription: result.offer.offerDescription || '',
      landingUrl: result.offer.landingUrl || '',
      vertical: result.offer.vertical,
      geoCountry: result.offer.geoCountry,
      language: result.offer.language,
      keywords: result.offer.keywords || [],
      competitorBrands: result.offer.competitorBrands || []
    },
    siteAudit: audit.requestedUrl ? Object.fromEntries(PUBLIC_AUDIT_FIELDS.map((k) => [k, audit[k]])) : null,
    keywords: (result.keywords || []).map(({ keyword, cluster, intent, matchType, volume, cpc, competition, competitionIndex, lowTopOfPageBid, highTopOfPageBid, monthlySearches, policyRisk, decision, dataSource, origin }) => ({
      keyword, cluster, intent, matchType, volume, cpc, competition, competitionIndex, lowTopOfPageBid, highTopOfPageBid, monthlySearches, policyRisk, decision, dataSource, origin
    })),
    clusters: (result.clusters || []).map(({ cluster, count, totalVolume, avgCpc, policyRisk, dataSource }) => ({ cluster, count, totalVolume, avgCpc, policyRisk, dataSource })),
    negatives: result.negatives || { accountNegatives: [], campaignNegatives: {} },
    rsa: (result.rsa || []).map(({ headlines, descriptions, pins }) => ({ headlines, descriptions, pins })),
    metrics: publicMetrics(result.metrics),
    serpResearch: (result.serpResearch || []).map(publicResearch),
    competitors: (result.competitors || []).map(({ domain, title, url, query, position, occurrences }) => ({ domain, title, url, query, position, occurrences })),
    aiExpansion: publicAi(result.aiExpansion),
    aiAds: publicAi(result.aiAds)
  };
}

export function publicBuild(doc, { withResult = true } = {}) {
  const jobs = {};
  for (const [name, job] of Object.entries(doc.jobs || {})) {
    jobs[name] = { status: job.status, error: job.error || null, finishedAt: job.finishedAt || null };
  }
  return {
    uid: doc.uid,
    status: doc.status,
    stage: doc.stage,
    error: doc.status === 'failed' ? doc.error : null,
    title: doc.title,
    vertical: doc.vertical,
    geo: doc.geo,
    language: doc.language,
    landingUrl: doc.landingUrl,
    keywordCount: doc.keywordCount,
    metricsMatched: doc.metricsMatched,
    createdAt: doc.createdAt,
    busy: doc.busy,
    busyAt: doc.busy ? doc.busyAt : null,
    jobs,
    limits: Object.fromEntries(Object.entries(JOB_LIMITS).map(([k, max]) => [k, { used: doc.usage?.[k] || 0, max, blocked: (doc.attempts?.[k] || 0) >= JOB_ATTEMPTS[k] }])),
    ...(withResult ? { result: doc.status === 'ready' ? publicResult(doc.result) : null } : {})
  };
}

// ------------------------------------------------------------------------------------------ helpers

function recountClusters(result) {
  result.clusters = (result.clusters || []).map((cluster) => {
    const rows = result.keywords.filter((k) => k.cluster === cluster.cluster);
    const matched = rows.filter((k) => k.dataSource === 'real');
    return {
      ...cluster,
      count: rows.length,
      totalVolume: matched.reduce((s, k) => s + (k.volume || 0), 0),
      avgCpc: matched.length ? Number((matched.reduce((s, k) => s + (k.cpc || 0), 0) / matched.length).toFixed(2)) : 0,
      dataSource: matched.length ? 'real' : 'unavailable'
    };
  });
}

/** Merges real metrics into keyword rows. Rows without a match keep "no data" — never invented numbers. */
function applyMetrics(result, response) {
  const byKeyword = new Map(response.items.map((m) => [m.keyword, m]));
  result.keywords = result.keywords.map((row) => {
    const m = byKeyword.get(metricsSafeKeyword(row.keyword));
    if (!m) return row;
    return {
      ...row,
      volume: m.volume,
      cpc: m.cpc,
      competition: m.competition,
      competitionIndex: m.competitionIndex,
      lowTopOfPageBid: m.lowTopOfPageBid,
      highTopOfPageBid: m.highTopOfPageBid,
      monthlySearches: m.monthlySearches,
      dataSource: 'real',
      confidence: 0.95,
      // Go = real demand (≥ 100/mo) without high competition; informational intent stays “caution”; no searches → no demand
      decision: m.volume <= 0 ? 'Не сходится' : row.cluster === 'info_discovery' ? 'Осторожно' : m.volume >= 100 && m.competition !== 'High' ? 'Льём' : 'Тест'
    };
  });
  recountClusters(result);
  const prev = result.metrics;
  result.metrics = { ...response.status, matchedCount: result.keywords.filter((k) => k.dataSource === 'real').length };
  if (response.status.status !== 'completed' && prev?.status === 'completed') result.metrics = { ...prev, lastError: response.status.error };
  result.cost = result.cost || {};
  result.cost.dataforseoCost = Number(((result.cost.dataforseoCost || 0) + (response.status.cost || 0)).toFixed(6));
}

async function mapConcurrent(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index]);
    }
  }));
  return output;
}

const domainOf = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    // display URLs look like "https://welcome.example.com › donor › page" — only the part before the breadcrumb is a URL
    const head = raw.split(/[\s›|]/)[0];
    const u = new URL(/^https?:\/\//i.test(head) ? head : `https://${head}`);
    const target = u.searchParams.get('url') || u.searchParams.get('adurl');
    const host = (target ? new URL(target).hostname : u.hostname).toLowerCase();
    return host.includes('.') ? registrable(host).domain : '';
  } catch {
    return '';
  }
};

/** Advertisers seen in verified paid results: one row per registrable domain (own landing and Google itself excluded). */
export function buildCompetitors(research, landingUrl) {
  const ownDomain = domainOf(landingUrl);
  const competitors = new Map();
  for (const r of research) {
    for (const ad of r.ads || []) {
      const domain = domainOf(ad.displayUrl);
      if (!domain || domain === ownDomain || IGNORED_SERP_DOMAINS.has(domain)) continue;
      const cur = competitors.get(domain);
      const best = Math.min(cur?.position || Infinity, ad.position || Infinity);
      competitors.set(domain, {
        domain,
        title: cur?.title || ad.headline,
        url: cur?.url || ad.displayUrl,
        query: cur?.query || r.keyword,
        position: Number.isFinite(best) ? best : 0,
        occurrences: (cur?.occurrences || 0) + 1
      });
    }
  }
  return Array.from(competitors.values()).sort((a, b) => b.occurrences - a.occurrences || a.position - b.position).slice(0, 50);
}

// ------------------------------------------------------------------------------------------ build pipeline

const STAGE_MSG = (lang) => {
  const t = tr(lang);
  return {
    audit: t('Не удалось открыть страницу лендинга', "Couldn't open the landing page"),
    generic: t('Не удалось собрать ключи. Дневная сборка возвращена — попробуйте ещё раз.', "Couldn't build the keywords. Your daily build was returned — please try again.")
  };
};

/** Runs the initial build in the background. Any failure marks the build failed and refunds the quota. */
export async function runBuildPipeline(buildId, offer, lang) {
  const set = (fields) => PpcBuild.updateOne({ _id: buildId, status: 'running' }, { $set: fields });
  const msg = STAGE_MSG(lang);
  try {
    let audit = emptyAudit();
    if (offer.landingUrl) {
      audit = await auditLandingPage(offer.landingUrl);
      if (!audit.checked) {
        const t = tr(lang);
        const reason = audit.status === 'blocked' ? t('адрес недоступен для проверки', "this address can't be checked")
          : audit.httpStatus ? t(`сайт ответил HTTP ${audit.httpStatus}`, `the site responded with HTTP ${audit.httpStatus}`)
            : t('сайт не открылся с наших серверов', "the site didn't open from our servers");
        const err = new Error(audit.error || audit.status);
        err.publicMessage = `${msg.audit}: ${reason}. ${t('Проверьте адрес или запустите сборку без URL — дневная сборка возвращена.', 'Check the address or run the build without a URL — your daily build was returned.')}`;
        throw err;
      }
    }
    await set({ stage: 'keywords' });
    const result = await UniversalKeywordEngine.executeBuild(offer, audit);
    result.keywords = result.keywords.map((k) => ({ ...k, origin: 'engine' }));
    result.cost = { ...result.cost, serpSearches: 0, aiCalls: 0 };
    result.siteAudit ||= audit;
    // the AI looks at the negative list while Google Ads metrics are fetched — it adds no wait of its own in most builds
    const negReview = aiKey() ? reviewNegativesWithAI(offer, audit, result.keywords, result.negatives?.accountNegatives || [], lang) : Promise.resolve(null);
    let usedMetrics = 0;
    if (metricsConfigured() && result.keywords.length) {
      await set({ stage: 'metrics' });
      const response = await getKeywordMetrics(result.keywords.map((k) => k.keyword), offer.geoCountry, offer.language);
      if (response.status.status !== 'completed') console.warn('[PpcHelper] metrics failed:', response.status.error);
      applyMetrics(result, response);
      usedMetrics = 1;
    } else {
      result.metrics = { status: 'unavailable', requestedCount: result.keywords.length, matchedCount: 0, geoCountry: offer.geoCountry, language: offer.language };
    }
    const negAi = await negReview;
    if (negAi) result.cost.aiCalls += 1;
    refineNegatives(result, negAi);
    await set({
      status: 'ready',
      stage: 'done',
      result,
      keywordCount: result.keywords.length,
      metricsMatched: result.metrics?.matchedCount || 0,
      'usage.metrics': usedMetrics
    });
  } catch (error) {
    console.error('[PpcHelper] build failed:', String(buildId), error.message);
    const failed = await PpcBuild.findOneAndUpdate(
      { _id: buildId, status: 'running' },
      { $set: { status: 'failed', error: error.publicMessage || msg.generic, errorInternal: String(error.message).slice(0, 500) } }
    );
    if (failed) await refundPpcCredit(failed.customerId, failed.creditDay);
  }
}

/** Builds stuck in `running` (process restart mid-build) are failed and refunded; stuck jobs are released. */
export async function settleStale(doc, lang) {
  const now = Date.now();
  if (doc.status === 'running' && now - new Date(doc.createdAt).getTime() > STALE_MS) {
    const failed = await PpcBuild.findOneAndUpdate(
      { _id: doc._id, status: 'running' },
      { $set: { status: 'failed', error: STAGE_MSG(lang).generic, errorInternal: 'stale: process restarted or timed out' } },
      { returnDocument: 'after' }
    );
    if (failed) { await refundPpcCredit(failed.customerId, failed.creditDay); return failed; }
  }
  if (doc.busy && now - new Date(doc.busyAt).getTime() > STALE_MS) {
    const job = doc.busy;
    const released = await PpcBuild.findOneAndUpdate(
      { _id: doc._id, busy: job, busyAt: doc.busyAt },
      { $set: { busy: null, busyAt: null, [`jobs.${job}`]: { status: 'failed', error: tr(lang)('Проверка не завершилась — попробуйте ещё раз', "The check didn't finish — please try again"), finishedAt: new Date() } }, $inc: { [`usage.${job}`]: -1 } },
      { returnDocument: 'after' }
    );
    if (released) return released;
  }
  return doc;
}

// ------------------------------------------------------------------------------------------ follow-up jobs

/**
 * Atomically reserves a job on a ready build: not busy, run limit not reached. Returns the doc or null.
 * The run counter is incremented up front so parallel clicks / tabs can't spend twice.
 */
export function acquireJob(uid, customerId, job) {
  return PpcBuild.findOneAndUpdate(
    { uid, customerId, status: 'ready', busy: null, [`usage.${job}`]: { $lt: JOB_LIMITS[job] }, [`attempts.${job}`]: { $not: { $gte: JOB_ATTEMPTS[job] } } },
    { $set: { busy: job, busyAt: new Date(), [`jobs.${job}`]: { status: 'running', error: null, startedAt: new Date() } }, $inc: { [`usage.${job}`]: 1, [`attempts.${job}`]: 1 } },
    { returnDocument: 'after' }
  );
}

async function finishJob(doc, job, fields, { failed = null, refundRun = false } = {}) {
  await PpcBuild.updateOne(
    { _id: doc._id, busy: job },
    {
      $set: { ...fields, busy: null, busyAt: null, [`jobs.${job}`]: { status: failed ? 'failed' : 'done', error: failed, finishedAt: new Date() } },
      ...(refundRun ? { $inc: { [`usage.${job}`]: -1 } } : {})
    }
  );
}

const JOB_RUNNERS = {
  async metrics(doc, _input, lang) {
    const result = doc.result;
    const response = await getKeywordMetrics(result.keywords.map((k) => k.keyword), result.offer.geoCountry, result.offer.language);
    if (response.status.status !== 'completed') {
      console.warn('[PpcHelper] metrics refresh failed:', response.status.error);
      result.cost = result.cost || {};
      result.cost.dataforseoCost = Number(((result.cost.dataforseoCost || 0) + (response.status.cost || 0)).toFixed(6));
      return { fields: { 'result.cost': result.cost }, failed: tr(lang)('Статистика сейчас недоступна, попробуйте позже', 'Statistics are unavailable right now, try again later'), refundRun: true };
    }
    applyMetrics(result, response);
    refineNegatives(result);
    return { fields: { 'result.keywords': result.keywords, 'result.negatives': result.negatives, 'result.clusters': result.clusters, 'result.metrics': result.metrics, 'result.cost': result.cost, metricsMatched: result.metrics.matchedCount } };
  },

  async serp(doc, input, lang) {
    const result = doc.result;
    const results = await mapConcurrent(input.keywords, SERP_CONCURRENCY, async (keyword) => {
      const r = await runSerpSearch(keyword, result.offer.geoCountry, result.offer.language);
      if (!r) return { keyword, status: 'unavailable', adCount: 0, organicCount: 0, ads: [], organic: [] };
      const usable = r.status === 'completed' && r.localeVerified === true;
      if (!usable) console.warn('[PpcHelper] SERP not usable:', keyword, r.error);
      return {
        keyword,
        status: usable ? 'completed' : 'failed',
        searchId: r.id,
        requestedLocale: r.requestedLocale,
        returnedLocale: r.language,
        localeVerified: r.localeVerified === true,
        adCount: usable ? r.ads.length : 0,
        organicCount: usable ? r.organic.length : 0,
        ads: usable ? r.ads : [],
        organic: usable ? r.organic : [],
        internalError: usable ? undefined : String(r.error || '').slice(0, 300)
      };
    });
    const merged = new Map((result.serpResearch || []).map((r) => [r.keyword, r]));
    for (const r of results) merged.set(r.keyword, r);
    const research = Array.from(merged.values());
    const cost = { ...(result.cost || {}), serpSearches: (result.cost?.serpSearches || 0) + results.length };
    const anyUsable = results.some((r) => r.status === 'completed');
    return {
      fields: {
        'result.serpResearch': research,
        'result.competitors': buildCompetitors(research, result.offer.landingUrl),
        'result.cost': cost
      },
      failed: anyUsable ? null : tr(lang)('Выдачу не удалось подтвердить для выбранной страны и языка — попытка возвращена', "Couldn't verify the search results for the selected country and language — the run was returned"),
      refundRun: !anyUsable
    };
  },

  async expand(doc) {
    const result = doc.result;
    const ai = await expandAndReviewWithAI(result.offer, result.keywords, result.negatives, result.siteAudit);
    if (ai.warning) console.warn('[PpcHelper] AI expand fallback:', ai.warning);
    const cost = { ...(result.cost || {}), aiCalls: (result.cost?.aiCalls || 0) + 1 };
    return { fields: { 'result.aiExpansion': { ...ai, applied: [] }, 'result.cost': cost } };
  },

  async ads(doc) {
    const result = doc.result;
    const ai = await generateAdVariantsWithAI(result.offer, result.serpResearch || [], result.siteAudit);
    if (ai.warning) console.warn('[PpcHelper] AI ads fallback:', ai.warning);
    const cost = { ...(result.cost || {}), aiCalls: (result.cost?.aiCalls || 0) + 1 };
    return { fields: { 'result.aiAds': ai, 'result.cost': cost } };
  }
};

/** Runs a reserved job in the background and releases the build when done. Never throws. */
export async function runJob(doc, job, input, lang) {
  try {
    const out = await JOB_RUNNERS[job](doc, input, lang);
    await finishJob(doc, job, out.fields || {}, { failed: out.failed || null, refundRun: !!out.refundRun });
  } catch (error) {
    console.error(`[PpcHelper] job ${job} failed:`, doc.uid, error.message);
    await finishJob(doc, job, {}, { failed: tr(lang)('Не удалось выполнить — попробуйте ещё раз', "Couldn't complete — please try again"), refundRun: true });
  }
}

/** Adds accepted AI keyword candidates / negative terms. Only items the AI actually suggested for this build are accepted. */
export function applyAiCandidates(result, { keywords = [], negatives = [] }) {
  const ai = result.aiExpansion || {};
  const suggestedNeg = (result.negatives?.suggested || []).map((n) => n.term);
  if (!result.aiExpansion && !suggestedNeg.length) return { added: 0, negativesAdded: 0 };
  const offered = new Map((ai.suggestions || []).map((s) => [s.keyword.toLowerCase().trim(), s]));
  const existing = new Set(result.keywords.map((k) => k.keyword.toLowerCase().trim()));
  const policyRisk = ['finance', 'gambling'].includes(result.offer.vertical) ? 'High' : 'Medium';
  const additions = [];
  for (const raw of keywords) {
    const key = String(raw || '').toLowerCase().trim();
    const s = offered.get(key);
    if (!s || existing.has(key)) continue;
    existing.add(key);
    additions.push({
      keyword: key.replace(/\s+/g, ' '),
      cluster: CLUSTERS.includes(s.cluster) ? s.cluster : 'generic_commercial',
      intent: s.intent || 'Commercial expansion',
      matchType: 'Phrase',
      volume: 0,
      cpc: 0,
      competition: 'Unknown',
      policyRisk,
      decision: 'Тест',
      dataSource: 'unavailable',
      confidence: 0.45,
      origin: 'ai'
    });
  }
  // negatives can come from the AI tab or from the build-time review suggestions
  const offeredNeg = new Set([...(ai.negativeReviews || []).filter((n) => n.scope !== 'keep').map((n) => String(n.term).toLowerCase().trim()), ...suggestedNeg]);
  const accountNeg = new Set((result.negatives?.accountNegatives || []).map((n) => n.toLowerCase().trim()));
  const negAdded = [];
  for (const raw of negatives) {
    const term = String(raw || '').toLowerCase().trim();
    if (!offeredNeg.has(term) || accountNeg.has(term)) continue;
    accountNeg.add(term);
    negAdded.push(term);
  }
  result.keywords = [...result.keywords, ...additions];
  result.negatives = { ...(result.negatives || {}), accountNegatives: [...(result.negatives?.accountNegatives || []), ...negAdded], sources: { ...(result.negatives?.sources || {}), ...Object.fromEntries(negAdded.map((t) => [t, 'ai'])) }, notes: { ...(result.negatives?.notes || {}), ...Object.fromEntries((result.negatives?.suggested || []).filter((n) => negAdded.includes(n.term) && n.reason).map((n) => [n.term, n.reason])) } };
  recountClusters(result);
  // new keywords can collide with old negatives and new negatives with keywords — re-check both ways
  refineNegatives(result);
  const keptNeg = new Set(result.negatives.accountNegatives);
  const negBlocked = negAdded.filter((t) => !keptNeg.has(t)).length;
  if (result.aiExpansion) ai.applied = Array.from(new Set([...(ai.applied || []), ...additions.map((a) => a.keyword), ...negAdded]));
  return { added: additions.length, negativesAdded: negAdded.length - negBlocked, negativesBlocked: negBlocked };
}
