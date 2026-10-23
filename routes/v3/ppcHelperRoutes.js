import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getPpcHelperLimits,
  checkPpcUrl,
  createPpcBuild,
  listPpcBuilds,
  getPpcBuild,
  startPpcJob,
  applyPpcCandidates,
  getPpcAdminUsage,
  detectPpcSite
} from '../../controllers/ppcHelperController.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';
import { verifyToken, isAdmin } from '../../middlewares/authMiddleware.js';

const limiter = (max, message = 'Too many requests. Try again later.') =>
  rateLimit({ windowMs: 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { message } });

/**
 * Builds and jobs call paid APIs (metrics, SERP, LLM): login + daily quota + per-build job caps,
 * plus these abuse guards. Reads are polled every few seconds while a step runs.
 * `auth` must set req.customer — production uses verifyCustomer; the test server passes an
 * "optional login" middleware (guests get a signed guest id), `beforeCreate` adds its guest guards.
 */
export function createPpcHelperRouter({ auth = verifyCustomer, beforeCreate = [] } = {}) {
  const router = express.Router();
  router.get('/admin/usage', verifyToken, isAdmin, getPpcAdminUsage);
  router.get('/check-url', auth, limiter(40), checkPpcUrl);
  router.get('/detect', auth, limiter(15), detectPpcSite);
  router.get('/limits', auth, limiter(60), getPpcHelperLimits);
  router.post('/builds', auth, limiter(4), ...beforeCreate, createPpcBuild);
  router.get('/builds', auth, limiter(60), listPpcBuilds);
  router.get('/builds/:uid', auth, limiter(120), getPpcBuild);
  router.post('/builds/:uid/jobs/:job', auth, limiter(10), startPpcJob);
  router.post('/builds/:uid/apply', auth, limiter(20), applyPpcCandidates);
  return router;
}

export default createPpcHelperRouter();
