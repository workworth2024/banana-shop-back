/**
 * TEST-only API for the Site Analyzer redesign: serves just /api/v3/analyzer from this
 * worktree (git branch site-analyzer-test), so the new analyzer can be tried on the test
 * front (https://isitmeorgoogle.banana-traff-shop.com:8443/site-analyzer) while production
 * keeps running main in the `banana-shop-back` process.
 *
 * No login required on the test environment:
 *   - logged-in customers go through the normal controller (credits + saved history);
 *   - guests get scans without credits and without saving to the DB (the test front keeps
 *     their history in localStorage), limited per IP so the paid APIs can't be drained.
 *
 * Deliberately does NOT start anything else from server.js (broadcast scheduler, cleanup
 * timers, bots) — those must run exactly once, in production.
 *
 *   pm2 start scripts/analyzerTestServer.js --name banana-analyzer-test
 */
import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import CustomerUser from '../models/CustomerUser.js';
import CustomerSession from '../models/CustomerSession.js';
import { getAnalyzerLimits, runAnalyzerScan, getMyAnalyses, getMyAnalysis, checkAnalyzerUrl } from '../controllers/analyzerController.js';
import { checkUrl } from '../services/siteAnalyzer/urlTools.js';
import { runSiteScan } from '../services/siteAnalyzer/index.js';
import { normalizeUrl, localizeFetchError } from '../services/siteAnalyzer/htmlFetcher.js';
import { normalizeLang } from '../services/siteAnalyzer/i18n.js';

const PORT = Number(process.env.ANALYZER_TEST_PORT || 8010);
const GUEST_DAILY_LIMIT = Number(process.env.ANALYZER_TEST_GUEST_DAILY || 30);

// same checks as middlewares/customerAuthMiddleware.js, but a missing/invalid token means "guest"
async function optionalCustomer(req, res, next) {
  const token = req.cookies.customer_token || req.headers.authorization?.split(' ')[1];
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'customer') return next();
    const session = await CustomerSession.findOne({ token, userId: decoded.id });
    if (!session || session.expire < new Date()) return next();
    const user = await CustomerUser.findById(decoded.id);
    if (user?.status) req.customer = user;
  } catch { /* guest */ }
  next();
}

const guestUsage = new Map(); // `${day}:${ip}` → scans today
const guestKey = (req) => `${new Date().toISOString().slice(0, 10)}:${req.ip}`;
const guestLimits = (req) => {
  const used = guestUsage.get(guestKey(req)) || 0;
  return { guest: true, dailyLimit: GUEST_DAILY_LIMIT, dailyUsed: used, bonusCredits: 0, totalRemaining: Math.max(0, GUEST_DAILY_LIMIT - used) };
};

const router = express.Router();
const scanLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many scan requests. Try again later.' } });

router.get('/check-url', rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false }), checkAnalyzerUrl);
router.get('/limits', optionalCustomer, (req, res) => (req.customer ? getAnalyzerLimits(req, res) : res.json(guestLimits(req))));

router.post('/scan', optionalCustomer, scanLimiter, async (req, res) => {
  if (req.customer) return runAnalyzerScan(req, res);
  const lang = normalizeLang(req.body?.lang);
  const en = lang === 'en';
  const { url, vertical = 'auto', geo = 'auto' } = req.body || {};
  const checked = await checkUrl(url, lang);
  if (!checked.ok) return res.status(422).json({ message: checked.reason, suggestion: checked.suggestion || null, fixes: checked.fixes });
  const normalizedUrl = normalizeUrl(checked.url);
  const limits = guestLimits(req);
  if (limits.totalRemaining <= 0) {
    return res.status(429).json({ message: en ? 'Daily guest limit reached on the test environment.' : 'Дневной лимит гостевых проверок на тестовом стенде исчерпан.', limits });
  }
  guestUsage.set(guestKey(req), limits.dailyUsed + 1);
  try {
    const result = await runSiteScan({ url: normalizedUrl, vertical, geo, lang });
    return res.json({
      analysis: { uid: `GUEST-${crypto.randomBytes(5).toString('hex').toUpperCase()}`, url: result.url, vertical: result.vertical, geo: result.geo, createdAt: new Date().toISOString(), ...result },
      limits: guestLimits(req)
    });
  } catch (e) {
    guestUsage.set(guestKey(req), Math.max(0, (guestUsage.get(guestKey(req)) || 1) - 1));
    console.error('[AnalyzerTest] guest scan failed:', e.message);
    return res.status(502).json({ message: en ? `Couldn't scan the site: ${localizeFetchError(e.message, lang)}` : `Не удалось просканировать сайт: ${e.message}` });
  }
});

router.get('/history', optionalCustomer, (req, res) => (req.customer ? getMyAnalyses(req, res) : res.json({ analyses: [], total: 0, pages: 1, currentPage: 1, guest: true })));
router.get('/history/:uid', optionalCustomer, (req, res) => (req.customer ? getMyAnalysis(req, res) : res.status(404).json({ message: 'Analysis not found' })));

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use('/api/v3/analyzer', router);
app.get('/api/v3/analyzer-test/health', (req, res) => res.json({ ok: true }));
app.use((err, req, res, next) => {
  console.error('[AnalyzerTest]', err.message);
  res.status(err.status || 500).json({ message: 'Internal server error' });
});

await mongoose.connect(process.env.MONGO_URI);
app.listen(PORT, '127.0.0.1', () => console.log(`Analyzer TEST API on 127.0.0.1:${PORT}`));
