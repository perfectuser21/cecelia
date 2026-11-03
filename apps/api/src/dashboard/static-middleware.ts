import express, { type RequestHandler } from 'express';
import compression from 'compression';
import {rateLimit} from 'express-rate-limit';
import { join } from 'node:path';

export function createCompressionMiddleware(): RequestHandler {
  return compression() as unknown as RequestHandler;
}

export function createStaticAssetMiddleware(frontendPath: string) {
  const router = express.Router();
  router.use('/assets', express.static(join(frontendPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));
  router.use(express.static(frontendPath, { maxAge: 0, etag: true }));
  return router;
}

export function createSpaFallback(frontendPath: string, {limit = 600}: {limit?: number} = {}): RequestHandler {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('SPA request budget must be a positive integer');
  const router = express.Router();
  // 保护本进程的文件读取预算；不依赖可伪造来源头或反向代理IP配置。
  router.get('*', rateLimit({
    windowMs: 60_000, limit, keyGenerator: () => 'dashboard-spa',
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: {error: 'dashboard_spa_rate_limited'},
  }), (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(frontendPath, 'index.html'));
  });
  return router;
}
