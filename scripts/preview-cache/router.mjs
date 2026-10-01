import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { createCacheService } from './service.mjs';
export function createCacheRouter({ token = process.env.DEPLOY_TOKEN, service = createCacheService() } = {}) {
  const router = Router();
  router.use((req, res, next) => {
    const actual = Buffer.from(req.headers.authorization || ''); const expected = Buffer.from(`Bearer ${token || ''}`);
    if (!token || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'UNAUTHORIZED' });
    next();
  });
  const invoke = fn => async (req, res) => {
    try { res.json(await fn(req)); } catch (err) { res.status(err.status || 503).json({ error: err.code || 'CACHE_UNAVAILABLE' }); }
  };
  router.post('/plan', invoke(req => service.plan(req.body)));
  router.post('/execute', invoke(req => service.execute(req.body)));
  router.get('/receipts/:intent', invoke(req => service.receipt(req.params.intent)));
  return router;
}
