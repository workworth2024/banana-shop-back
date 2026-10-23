import CustomerUser from '../models/CustomerUser.js';
import SiteAnalysis from '../models/SiteAnalysis.js';
import { runSiteScan } from '../services/siteAnalyzer/index.js';
import { normalizeUrl, localizeFetchError } from '../services/siteAnalyzer/htmlFetcher.js';
import { normalizeLang } from '../services/siteAnalyzer/i18n.js';
import { checkUrl } from '../services/siteAnalyzer/urlTools.js';
import {
  getAnalyzerLimitsView,
  consumeAnalyzerCredit,
  refundAnalyzerCredit,
  takeAnalyzerIpSlot,
  takeFailedScanRefund
} from '../utils/analyzerCredits.js';

// a scan takes up to ~2 min; an older 'pending' row is a crashed scan and doesn't block the next one
const ACTIVE_SCAN_WINDOW_MS = 4 * 60 * 1000;
const ALLOWED_VERTICALS = /^[a-z_]{2,20}$/;
import { escapeRegex } from '../utils/safeQuery.js';

export const getAnalyzerLimits = async (req, res) => {
  try {
    return res.status(200).json(getAnalyzerLimitsView(req.customer));
  } catch (error) {
    console.error('[Analyzer] getAnalyzerLimits error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const runAnalyzerScan = async (req, res) => {
  const customerId = req.customer._id;
  let creditSource = null;
  let creditDay;

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { url } = body;
    // only plain short strings reach the scanner / DB (no objects, no oversized values)
    const vertical = typeof body.vertical === 'string' && ALLOWED_VERTICALS.test(body.vertical) ? body.vertical : 'auto';
    const geo = typeof body.geo === 'string' && /^([A-Za-z]{2}|auto)$/.test(body.geo) ? body.geo : 'auto';
    // report language = the language selected on the site
    const lang = normalizeLang(body.lang);
    const en = lang === 'en';
    if (!url || typeof url !== 'string' || url.length > 2000) {
      return res.status(400).json({ message: en ? 'URL is required' : 'URL обязателен' });
    }

    // one scan at a time per account — parallel requests can't fan out paid API calls / Chrome renders
    const running = await SiteAnalysis.exists({ customerId, status: 'pending', createdAt: { $gt: new Date(Date.now() - ACTIVE_SCAN_WINDOW_MS) } });
    if (running) {
      return res.status(429).json({ message: en ? 'A scan is already running — wait for it to finish.' : 'Проверка уже идёт — дождитесь её завершения.' });
    }

    // repair typos and make sure the domain exists BEFORE a credit is spent
    const checked = await checkUrl(url, lang);
    if (!checked.ok) {
      return res.status(422).json({ message: checked.reason, suggestion: checked.suggestion || null, fixes: checked.fixes });
    }
    const normalizedUrl = normalizeUrl(checked.url);

    let consumed = await consumeAnalyzerCredit(customerId);
    // free scans are also capped per network across accounts (multi-account farming); paid bonus scans are not
    if (consumed.ok && consumed.source === 'daily' && !(await takeAnalyzerIpSlot(req.ip, consumed.day).catch(() => false))) {
      await refundAnalyzerCredit(customerId, 'daily', consumed.day);
      consumed = await consumeAnalyzerCredit(customerId, { bonusOnly: true });
      if (!consumed.ok) {
        return res.status(429).json({
          message: en
            ? 'The daily limit of free scans from your network has been reached. Try again tomorrow or make a purchase to get bonus scans.'
            : 'Дневной лимит бесплатных проверок с вашей сети исчерпан. Попробуйте завтра или совершите покупку, чтобы получить бонусные проверки.',
          limits: getAnalyzerLimitsView(await CustomerUser.findById(customerId).select('analyzer'))
        });
      }
    }
    if (!consumed.ok) {
      const limits = getAnalyzerLimitsView(req.customer);
      return res.status(429).json({
        message: en ? 'Daily scan limit reached. Make a purchase to get extra scans.' : 'Дневной лимит анализов исчерпан. Совершите покупку, чтобы получить дополнительные проверки.',
        limits
      });
    }
    creditSource = consumed.source;
    creditDay = consumed.day;

    const record = await SiteAnalysis.create({
      customerId,
      url: normalizedUrl,
      vertical: String(vertical || 'auto').slice(0, 20),
      geo: String(geo || 'auto').slice(0, 4).toUpperCase(),
      status: 'pending',
      creditSource
    });

    try {
      const result = await runSiteScan({ url: normalizedUrl, vertical, geo, lang });

      record.status = 'completed';
      record.vertical = result.vertical;
      record.favicon = result.favicon || null;
      record.geo = result.geo;
      record.riskScore = result.risk.score;
      record.riskLevel = result.risk.level;
      record.result = result;
      await record.save();

      const freshCustomer = await CustomerUser.findById(customerId).select('analyzer');
      return res.status(200).json({
        analysis: {
          uid: record.uid,
          url: record.url,
          vertical: record.vertical,
          geo: record.geo,
          createdAt: record.createdAt,
          ...result
        },
        limits: getAnalyzerLimitsView(freshCustomer)
      });
    } catch (scanError) {
      console.error('[Analyzer] scan failed:', scanError.message);
      record.status = 'failed';
      record.error = scanError.message;
      await record.save();
      // failed scans still cost us the external calls — only the first few per day are refunded
      if (await takeFailedScanRefund(customerId)) await refundAnalyzerCredit(customerId, creditSource, creditDay);

      return res.status(502).json({
        message: en ? `Couldn't scan the site: ${localizeFetchError(scanError.message, lang)}` : `Не удалось просканировать сайт: ${scanError.message}`
      });
    }
  } catch (error) {
    console.error('[Analyzer] runAnalyzerScan error:', error);
    if (creditSource) await refundAnalyzerCredit(customerId, creditSource, creditDay);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getMyAnalyses = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pg - 1) * lim;

    const query = { customerId: req.customer._id };
    if (search) {
      const safe = escapeRegex(String(search).slice(0, 200));
      query.$or = [{ url: { $regex: safe, $options: 'i' } }, { uid: { $regex: safe, $options: 'i' } }];
    }

    const [items, total] = await Promise.all([
      SiteAnalysis.find(query)
        .select('-result')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(lim)
        .lean(),
      SiteAnalysis.countDocuments(query)
    ]);

    return res.status(200).json({
      analyses: items,
      total,
      pages: Math.ceil(total / lim),
      currentPage: pg
    });
  } catch (error) {
    console.error('[Analyzer] getMyAnalyses error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getMyAnalysis = async (req, res) => {
  try {
    const analysis = await SiteAnalysis.findOne({
      uid: req.params.uid,
      customerId: req.customer._id
    }).lean();
    if (!analysis) return res.status(404).json({ message: 'Analysis not found' });
    return res.status(200).json({ analysis });
  } catch (error) {
    console.error('[Analyzer] getMyAnalysis error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/** Public helper for the scan form: cleans the typed URL and checks the domain resolves. */
export const checkAnalyzerUrl = async (req, res) => {
  const lang = normalizeLang(req.query.lang);
  try {
    return res.json(await checkUrl(String(req.query.url || '').slice(0, 2000), lang));
  } catch (e) {
    console.error('[Analyzer] check-url error:', e.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
};
