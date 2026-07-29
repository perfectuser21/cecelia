/**
 * Acceptance 公网 listener（5223）— 只挂 pending/results 两个端点
 * fail-closed：ACCEPTANCE_API_TOKEN 未配置则不启动
 * 决策 c08c2173：禁止把 5221 Brain API 整体暴露公网
 */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { createAcceptancePublicRouter } from './routes/acceptance.js';

export function createBearerAuth(expectedToken) {
  const expectedBuf = Buffer.from(String(expectedToken));
  return function bearerAuth(req, res, next) {
    const header = req.headers['authorization'] || '';
    const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const givenBuf = Buffer.from(given);
    const ok = expectedBuf.length === givenBuf.length && timingSafeEqual(expectedBuf, givenBuf);
    if (!ok) return res.status(401).json({ error: 'unauthorized' });
    return next();
  };
}

export function createAcceptancePublicApp({ pool, token }) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));
  app.use(createBearerAuth(token));
  app.use(createAcceptancePublicRouter({ pool }));
  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  return app;
}

export function startAcceptancePublicServer({ pool, port }) {
  const token = process.env.ACCEPTANCE_API_TOKEN;
  if (!token) {
    console.log('[acceptance-public] ACCEPTANCE_API_TOKEN 未配置，公网 listener 不启动（fail-closed）');
    return null;
  }
  const app = createAcceptancePublicApp({ pool, token });
  const server = createServer(app);
  server.on('error', (err) => console.error('[acceptance-public] listener error:', err.message));
  server.listen(port, () => {
    console.log(`[acceptance-public] listening on :${port}（仅 /acceptance/pending 与 /acceptance/results）`);
  });
  return server;
}
