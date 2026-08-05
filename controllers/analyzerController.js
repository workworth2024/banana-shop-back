import CustomerUser from '../models/CustomerUser.js';
import SiteAnalysis from '../models/SiteAnalysis.js';
import { runSiteScan } from '../services/siteAnalyzer/index.js';
import { normalizeUrl } from '../services/siteAnalyzer/htmlFetcher.js';
import {
  getAnalyzerLimitsView,
  consumeAnalyzerCredit,
  refundAnalyzerCredit
} from '../utils/analyzerCredits.js';
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

  try {
    const { url, vertical = 'general', geo = 'US' } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ message: 'URL обязателен' });
    }

    let normalizedUrl;
    try {
      normalizedUrl = normalizeUrl(url);
    } catch {
      return res.status(400).json({ message: 'Некорректный URL' });
    }

    const consumed = await consumeAnalyzerCredit(customerId);
    if (!consumed.ok) {
      const limits = getAnalyzerLimitsView(req.customer);
      return res.status(429).json({
        message: 'Дневной лимит анализов исчерпан. Совершите покупку, чтобы получить дополнительные проверки.',
        limits
      });
    }
    creditSource = consumed.source;

    const record = await SiteAnalysis.create({
      customerId,
      url: normalizedUrl,
      vertical,
      geo: String(geo || 'US').toUpperCase(),
      status: 'pending',
      creditSource
    });

    try {
      const result = await runSiteScan({ url: normalizedUrl, vertical, geo });

      record.status = 'completed';
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
      await refundAnalyzerCredit(customerId, creditSource);

      return res.status(502).json({
        message: `Не удалось просканировать сайт: ${scanError.message}`
      });
    }
  } catch (error) {
    console.error('[Analyzer] runAnalyzerScan error:', error);
    if (creditSource) await refundAnalyzerCredit(customerId, creditSource);
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
