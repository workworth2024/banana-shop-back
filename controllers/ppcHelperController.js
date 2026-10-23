import PpcBuild from '../models/PpcBuild.js';
import { getPpcLimits, consumePpcCredit, refundPpcCredit } from '../utils/ppcCredits.js';
import { checkUrl } from '../services/siteAnalyzer/urlTools.js';
import { normalizeLang, tr } from '../services/siteAnalyzer/i18n.js';
import { escapeRegex } from '../utils/safeQuery.js';
import { detectFromUrl } from '../services/ppcHelper/detect.js';
import {
  validateOffer, publicBuild, runBuildPipeline, settleStale, acquireJob, runJob, applyAiCandidates,
  features, JOB_LIMITS, SERP_MAX_KEYWORDS
} from '../services/ppcHelper/index.js';

const UID_RE = /^PPC-[0-9A-F]{12}$/;
// req.ppcDailyLimit / req.ppcGuest are set only by the test server (scripts/ppcHelperTestServer.js) for guests
const limitsFor = async (req) => ({ ...(await getPpcLimits(req.customer._id, req.ppcDailyLimit)), ...(req.ppcGuest ? { guest: true } : {}) });
const langOf = (req) => normalizeLang(req.body?.lang || req.query?.lang);

const findOwn = (req) => (UID_RE.test(String(req.params.uid || ''))
  ? PpcBuild.findOne({ uid: req.params.uid, customerId: req.customer._id })
  : null);

export const getPpcHelperLimits = async (req, res) => {
  try {
    return res.json({ limits: await limitsFor(req), features: features(), jobLimits: JOB_LIMITS, serpMaxKeywords: SERP_MAX_KEYWORDS });
  } catch (error) {
    console.error('[PpcHelper] limits error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const checkPpcUrl = async (req, res) => {
  try {
    return res.json(await checkUrl(String(req.query.url || '').slice(0, 2000), langOf(req)));
  } catch (error) {
    console.error('[PpcHelper] check-url error:', error.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
};

/** "Fill from site": cleans the URL, then suggests offer name / vertical / GEO / language from the page. Free (no paid APIs). */
export const detectPpcSite = async (req, res) => {
  const lang = langOf(req);
  try {
    const checked = await checkUrl(String(req.query.url || '').slice(0, 2000), lang);
    if (!checked.ok) return res.json({ ok: false, reason: checked.reason, suggestion: checked.suggestion || null });
    return res.json({ url: checked.url, ...(await detectFromUrl(checked.url, lang)) });
  } catch (error) {
    console.error('[PpcHelper] detect error:', error.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
};

export const createPpcBuild = async (req, res) => {
  const lang = langOf(req);
  const t = tr(lang);
  try {
    const v = validateOffer(req.body, lang);
    if (!v.ok) return res.status(400).json({ message: v.message, field: v.field });
    const { offer } = v;

    // repair typos / make sure the domain exists BEFORE the daily build is spent
    if (offer.landingUrl) {
      const checked = await checkUrl(offer.landingUrl, lang);
      if (!checked.ok) return res.status(422).json({ message: checked.reason, suggestion: checked.suggestion || null, field: 'landingUrl' });
      offer.landingUrl = checked.url;
    }

    const running = await PpcBuild.findOne({ customerId: req.customer._id, status: 'running' }).select('_id createdAt status busy');
    if (running && (await settleStale(running, lang)).status === 'running') {
      return res.status(409).json({ message: t('Предыдущая сборка ещё выполняется — дождитесь её завершения', 'Your previous build is still running — please wait for it to finish') });
    }

    const consumed = await consumePpcCredit(req.customer._id, req.ppcDailyLimit);
    if (!consumed.ok) {
      return res.status(429).json({
        message: consumed.reason === 'attempts'
          ? t('Сегодня было слишком много неудачных сборок. Проверьте URL и данные оффера и попробуйте завтра.', 'Too many failed builds today. Check the URL and offer details and try again tomorrow.')
          : req.ppcGuest
          ? t('Гостевые сборки на сегодня закончились — войдите в аккаунт или приходите после 03:00 (UTC+3).', 'Guest builds for today are used up — sign in or come back after 00:00 UTC.')
          : t('Сборка на сегодня уже использована. Новая будет доступна в 03:00 (UTC+3).', "Today's build is already used. A new one is available at 00:00 UTC."),
        limits: await limitsFor(req)
      });
    }

    let build;
    try {
      build = await PpcBuild.create({
        customerId: req.customer._id,
        creditDay: consumed.day,
        title: offer.title,
        vertical: offer.vertical,
        geo: offer.geoCountry,
        language: offer.language,
        landingUrl: offer.landingUrl
      });
    } catch (e) {
      await refundPpcCredit(req.customer._id, consumed.day);
      throw e;
    }
    runBuildPipeline(build._id, offer, lang);
    return res.status(202).json({ build: publicBuild(build), limits: await limitsFor(req) });
  } catch (error) {
    console.error('[PpcHelper] create error:', error);
    return res.status(500).json({ message: t('Ошибка сервера', 'Server error') });
  }
};

export const listPpcBuilds = async (req, res) => {
  try {
    const page = Math.min(500, Math.max(1, parseInt(req.query.page, 10) || 1));
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 8));
    const query = { customerId: req.customer._id };
    const search = String(req.query.search || '').slice(0, 100).trim();
    if (search) query.title = { $regex: escapeRegex(search), $options: 'i' };
    const [items, total] = await Promise.all([
      PpcBuild.find(query).select('-result -errorInternal').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PpcBuild.countDocuments(query)
    ]);
    return res.json({ builds: items.map((d) => publicBuild(d, { withResult: false })), total, pages: Math.max(1, Math.ceil(total / limit)), currentPage: page });
  } catch (error) {
    console.error('[PpcHelper] list error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getPpcBuild = async (req, res) => {
  try {
    const doc = await findOwn(req)?.lean();
    if (!doc) return res.status(404).json({ message: tr(langOf(req))('Сборка не найдена', 'Build not found') });
    return res.json({ build: publicBuild(await settleStale(doc, langOf(req))) });
  } catch (error) {
    console.error('[PpcHelper] get error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const startPpcJob = async (req, res) => {
  const lang = langOf(req);
  const t = tr(lang);
  try {
    const job = String(req.params.job || '');
    if (!Object.hasOwn(JOB_LIMITS, job)) return res.status(404).json({ message: 'Not found' });
    const current = await findOwn(req)?.lean();
    if (!current) return res.status(404).json({ message: t('Сборка не найдена', 'Build not found') });
    const doc0 = await settleStale(current, lang);
    if (doc0.status !== 'ready') return res.status(409).json({ message: t('Сборка ещё не готова', 'The build is not ready yet') });

    const feats = features();
    if ((job === 'metrics' && !feats.metrics) || (job === 'serp' && !feats.serp)) {
      return res.status(503).json({ message: t('Эта проверка временно недоступна', 'This check is temporarily unavailable') });
    }

    let input = {};
    if (job === 'serp') {
      const own = new Set((doc0.result?.keywords || []).map((k) => k.keyword));
      const keywords = Array.from(new Set((Array.isArray(req.body?.keywords) ? req.body.keywords : []).map((k) => String(k || '').toLowerCase().trim()))).filter((k) => own.has(k));
      if (!keywords.length) return res.status(400).json({ message: t('Выберите ключи для проверки выдачи', 'Pick keywords to check') });
      if (keywords.length > SERP_MAX_KEYWORDS) return res.status(400).json({ message: t(`Не больше ${SERP_MAX_KEYWORDS} ключей за одну проверку`, `No more than ${SERP_MAX_KEYWORDS} keywords per check`) });
      input = { keywords };
    }

    if (doc0.busy) return res.status(409).json({ message: t('Дождитесь окончания текущей проверки', 'Wait for the current check to finish') });
    const doc = await acquireJob(doc0.uid, req.customer._id, job);
    if (!doc) {
      const fresh = await PpcBuild.findById(doc0._id).select('busy usage attempts').lean();
      return res.status(fresh?.busy ? 409 : 429).json({
        message: fresh?.busy
          ? t('Дождитесь окончания текущей проверки', 'Wait for the current check to finish')
          : (fresh?.usage?.[job] || 0) < JOB_LIMITS[job]
            ? t('Слишком много неудачных попыток этой проверки — она отключена для сборки', 'Too many failed attempts of this check — it is disabled for this build')
            : t('Лимит этой проверки для сборки исчерпан', 'The limit for this check is used up for this build')
      });
    }
    runJob(doc.toObject(), job, input, lang);
    return res.status(202).json({ build: publicBuild(doc) });
  } catch (error) {
    console.error('[PpcHelper] job error:', error);
    return res.status(500).json({ message: t('Ошибка сервера', 'Server error') });
  }
};

export const applyPpcCandidates = async (req, res) => {
  const lang = langOf(req);
  const t = tr(lang);
  try {
    const list = (v) => (Array.isArray(v) ? v.slice(0, 120).map((x) => String(x || '').slice(0, 120)) : []);
    const keywords = list(req.body?.keywords);
    const negatives = list(req.body?.negatives);
    if (!keywords.length && !negatives.length) return res.status(400).json({ message: t('Ничего не выбрано', 'Nothing selected') });
    const doc = await findOwn(req);
    if (!doc) return res.status(404).json({ message: t('Сборка не найдена', 'Build not found') });
    if (doc.status !== 'ready' || doc.busy) return res.status(409).json({ message: t('Дождитесь окончания текущей проверки', 'Wait for the current check to finish') });
    const result = doc.result;
    const applied = applyAiCandidates(result, { keywords, negatives });
    const updated = await PpcBuild.findOneAndUpdate(
      { _id: doc._id, busy: null, updatedAt: doc.updatedAt },
      { $set: { 'result.keywords': result.keywords, 'result.clusters': result.clusters, 'result.negatives': result.negatives, 'result.aiExpansion': result.aiExpansion, keywordCount: result.keywords.length } },
      { returnDocument: 'after' }
    );
    if (!updated) return res.status(409).json({ message: t('Сборка изменилась — обновите страницу', 'The build has changed — refresh the page') });
    return res.json({ build: publicBuild(updated), ...applied });
  } catch (error) {
    console.error('[PpcHelper] apply error:', error);
    return res.status(500).json({ message: t('Ошибка сервера', 'Server error') });
  }
};

/** Admin-only: what PPC Helper spends (recorded counters only — nothing is estimated). */
export const getPpcAdminUsage = async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
    const since = new Date(Date.now() - days * 86400000);
    const [totals] = await PpcBuild.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          builds: { $sum: 1 },
          ready: { $sum: { $cond: [{ $eq: ['$status', 'ready'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          customers: { $addToSet: '$customerId' },
          metricsJobs: { $sum: '$usage.metrics' },
          serpJobs: { $sum: '$usage.serp' },
          aiJobs: { $sum: { $add: ['$usage.expand', '$usage.ads'] } },
          serpSearches: { $sum: { $ifNull: ['$result.cost.serpSearches', 0] } },
          metricsCostUsd: { $sum: { $ifNull: ['$result.cost.dataforseoCost', 0] } }
        }
      },
      { $project: { _id: 0, customers: { $size: '$customers' }, builds: 1, ready: 1, failed: 1, metricsJobs: 1, serpJobs: 1, aiJobs: 1, serpSearches: 1, metricsCostUsd: 1 } }
    ]);
    const recentErrors = await PpcBuild.find({ createdAt: { $gte: since }, status: 'failed' })
      .select('uid title geo language errorInternal createdAt').sort({ createdAt: -1 }).limit(20).lean();
    return res.json({ days, features: features(), totals: totals || {}, recentErrors });
  } catch (error) {
    console.error('[PpcHelper] admin usage error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
