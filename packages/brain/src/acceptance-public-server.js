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
  if (!expectedToken || typeof expectedToken !== 'string') {
    throw new Error('createBearerAuth: expectedToken is required');
  }
  const expectedBuf = Buffer.from(expectedToken);
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
  app.disable('x-powered-by');
  app.set('trust proxy', 1);  // 本机 cloudflared 一层反代，req.ip 取真实客户端 IP
  app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use(createBearerAuth(token));
  app.use(express.json({ limit: '1mb' }));
  app.use(createAcceptancePublicRouter({ pool }));
  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed' || err?.status === 400) {
      return res.status(400).json({ error: 'bad request' });
    }
    console.error('[acceptance-public] unhandled error:', err?.message);
    return res.status(500).json({ error: 'internal_error' });
  });
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
  server.on('error', (err) => console.error('[acceptance-public][ALERT] listener error:', err.message));
  const host = process.env.ACCEPTANCE_PUBLIC_HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`[acceptance-public] listening on ${host}:${port}（仅 /acceptance/pending 与 /acceptance/results）`);
  });
  return server;
}
