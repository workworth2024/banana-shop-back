/**
 * TEST-only API for PPC Helper: serves just /api/v3/ppc-helper from this tree so the tool can be tried on
 * the test front (https://isitmeorgoogle.banana-traff-shop.com:8444/ppc-helper) without restarting the
 * production `banana-shop-back` process.
 *
 * No login required on the test environment (production keeps login + 1 build/day):
 *   - logged-in customers get exactly the production rules (their account, 1 build per UTC day);
 *   - guests get a random guest id in a signed httpOnly cookie (builds/history are tied to it),
 *     PPC_TEST_GUEST_DAILY builds per guest and PPC_TEST_IP_DAILY per IP so the paid APIs can't be drained.
 *
 * Deliberately does NOT start anything else from server.js (schedulers, bots) — those run once, in production.
 *
 *   pm2 start scripts/ppcHelperTestServer.js --name banana-ppc-test
 */
import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import CustomerUser from '../models/CustomerUser.js';
import CustomerSession from '../models/CustomerSession.js';
import { createPpcHelperRouter } from '../routes/v3/ppcHelperRoutes.js';

const PORT = Number(process.env.PPC_TEST_PORT || 8011);
const GUEST_DAILY = Math.max(1, Number(process.env.PPC_TEST_GUEST_DAILY) || 5);
const IP_DAILY = Math.max(GUEST_DAILY, Number(process.env.PPC_TEST_IP_DAILY) || 15);
const GUEST_COOKIE = 'ppc_guest';
const GUEST_COOKIE_MAX_AGE = 30 * 24 * 3600 * 1000;
const SECRET = crypto.createHash('sha256').update(`ppc-test-guest:${process.env.JWT_SECRET}`).digest();

const sign = (id) => crypto.createHmac('sha256', SECRET).update(id).digest('base64url');
function readGuestId(raw) {
  const [id, mac] = String(raw || '').split('.');
  if (!/^[0-9a-f]{24}$/.test(id || '') || !mac) return null;
  const expected = sign(id);
  return mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? id : null;
}

// same checks as middlewares/customerAuthMiddleware.js, but a missing/invalid token means "guest"
async function optionalCustomer(req, res, next) {
  const token = req.cookies.customer_token || req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.type === 'customer') {
        const session = await CustomerSession.findOne({ token, userId: decoded.id });
        const user = session && session.expire >= new Date() ? await CustomerUser.findById(decoded.id) : null;
        if (user?.status) { req.customer = user; return next(); }
      }
    } catch { /* guest */ }
  }
  let id = readGuestId(req.cookies[GUEST_COOKIE]);
  if (!id) {
    id = crypto.randomBytes(12).toString('hex'); // random, unlike a fresh ObjectId — not guessable
    res.cookie(GUEST_COOKIE, `${id}.${sign(id)}`, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/v3/ppc-helper', maxAge: GUEST_COOKIE_MAX_AGE });
  }
  req.customer = { _id: new mongoose.Types.ObjectId(id) };
  req.ppcGuest = true;
  req.ppcDailyLimit = GUEST_DAILY;
  next();
}

// per-IP cap for guests, so clearing the cookie doesn't give unlimited paid builds
const ipBuilds = new Map(); // `${day}:${ip}` → builds started today
function guestIpGuard(req, res, next) {
  if (!req.ppcGuest) return next();
  const key = `${new Date().toISOString().slice(0, 10)}:${req.ip}`;
  if ((ipBuilds.get(key) || 0) >= IP_DAILY) {
    return res.status(429).json({ message: 'Дневной лимит гостевых сборок на тестовом стенде исчерпан — войдите в аккаунт.' });
  }
  res.on('finish', () => {
    if (res.statusCode === 202) ipBuilds.set(key, (ipBuilds.get(key) || 0) + 1);
  });
  for (const k of ipBuilds.keys()) if (!k.startsWith(key.slice(0, 10))) ipBuilds.delete(k);
  next();
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use('/api/v3/ppc-helper', createPpcHelperRouter({ auth: optionalCustomer, beforeCreate: [guestIpGuard] }));
app.get('/api/v3/ppc-helper-test/health', (req, res) => res.json({ ok: true }));
app.use((err, req, res, next) => {
  console.error('[PpcTest]', err.message);
  res.status(err.status || 500).json({ message: err.status === 413 ? 'Request too large' : 'Internal server error' });
});

await mongoose.connect(process.env.MONGO_URI);
app.listen(PORT, '127.0.0.1', () => console.log(`PPC Helper TEST API on 127.0.0.1:${PORT} (guests: ${GUEST_DAILY}/day, ${IP_DAILY}/IP/day)`));
