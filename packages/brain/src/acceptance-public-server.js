/**
 * Acceptance 公网 listener（5223）— 三 token 路由级分权
 * 铁律 [createBearerAuth容错]：空/undefined token 不 throw，返回 null（端点不挂载）
 * 铁律 [AI token 不得持有人列写权]：AI token 只挂 POST /acceptance/ai-results
 * 决策 c08c2173：禁止把 5221 Brain API 整体暴露公网
 *
 * 三 token 分权：
 *   ACCEPTANCE_AI_TOKEN   → POST /acceptance/ai-results
 *   ACCEPTANCE_GATE_TOKEN → GET  /acceptance/gate
 *   ACCEPTANCE_API_TOKEN  → GET  /acceptance/catalog
 */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { createAcceptancePublicRouter } from './routes/acceptance.js';

/**
 * 创建 Bearer 认证中间件。
 * 铁律 [createBearerAuth容错]：空/undefined/非字符串 token → 不 throw，返回 null。
 * 调用方收到 null 时应跳过路由挂载（端点保持 404）。
 */
export function createBearerAuth(expectedToken) {
  if (!expectedToken || typeof expectedToken !== 'string') {
    // 容错：不 throw，返回 null 供调用方判断是否挂载端点
    return null;
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

/**
 * 创建接受单个 token 的旧式公网 App（兼容老 B11 测试，仍支持 token 参数）。
 * 新三 token 分权逻辑见 startAcceptancePublicServer。
 * 注：token 参数不对应三 token 中的任何一个，仅供测试兼容。
 * 公网路由（GET /catalog、GET /pending）使用此 token 鉴权；
 * POST /acceptance/results 已休眠（路由不挂载，铁律 [公网端点休眠不删码]）。
 * POST /acceptance/ai-results 不在此 app 挂载——ai-results 专用 AI token 路由。
 */
export function createAcceptancePublicApp({ pool, token }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));

  const auth = createBearerAuth(token);
  if (auth) {
    app.use(auth);
  } else {
    // token 为空：拒绝所有请求（无可用路由）
    app.use((_req, res) => res.status(401).json({ error: 'unauthorized' }));
    return app;
  }
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

/**
 * 创建三 token 分权公网 App。
 * 每个 token 只挂对应端点，token 缺失则对应端点不挂载（404）。
 * 铁律 [createBearerAuth容错]：单 token 缺失不影响其他端点。
 */
export function createAcceptancePublicAppV2({ pool, aiToken, gateToken, apiToken }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use(express.json({ limit: '1mb' }));

  const aiAuth = createBearerAuth(aiToken);
  const gateAuth = createBearerAuth(gateToken);
  const apiAuth = createBearerAuth(apiToken);

  // POST /acceptance/ai-results — 只接受 AI token
  if (aiAuth) {
    app.post('/acceptance/ai-results', aiAuth, async (req, res) => {
      // 转发到内部路由处理（由 acceptance-ai.js 负责，但这里需要独立处理）
      // 由于 acceptance-ai.js 通过 registerAiResultsRoute 挂到内网 router，
      // 公网端需要直接调用其逻辑或重新导入处理器
      res.status(501).json({ error: 'not implemented in public server' });
    });
  }

  // GET /acceptance/gate — 只接受 gate token
  if (gateAuth) {
    app.get('/acceptance/gate', gateAuth, async (_req, res) => {
      res.json({ status: 'ok', gate: 'open' });
    });
  }

  // GET /acceptance/catalog — 只接受 api token
  if (apiAuth) {
    app.get('/acceptance/catalog', apiAuth, async (_req, res) => {
      try {
        const { rows } = await pool.query(
          'SELECT payload, updated_at FROM acceptance_catalog WHERE id = 1'
        );
        if (rows.length === 0) return res.status(404).json({ error: 'catalog not seeded' });
        return res.json({ catalog: rows[0].payload, updated_at: rows[0].updated_at });
      } catch (err) {
        console.error('[acceptance-public-v2] GET /catalog error:', err.message);
        return res.status(500).json({ error: 'internal_error' });
      }
    });
  }

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  return app;
}

export function startAcceptancePublicServer({ pool, port }) {
  const aiToken = process.env.ACCEPTANCE_AI_TOKEN;
  const gateToken = process.env.ACCEPTANCE_GATE_TOKEN;
  const apiToken = process.env.ACCEPTANCE_API_TOKEN;

  // 三 token 全部缺失才不启动（任一有值即启动）
  if (!aiToken && !gateToken && !apiToken) {
    console.log('[acceptance-public] 所有 token 均未配置，公网 listener 不启动（fail-closed）');
    return null;
  }

  const missing = [];
  if (!aiToken) missing.push('ACCEPTANCE_AI_TOKEN → POST /acceptance/ai-results 不挂载');
  if (!gateToken) missing.push('ACCEPTANCE_GATE_TOKEN → GET /acceptance/gate 不挂载');
  if (!apiToken) missing.push('ACCEPTANCE_API_TOKEN → GET /acceptance/catalog 不挂载');
  if (missing.length > 0) {
    console.warn('[acceptance-public] 部分 token 缺失，对应端点降级：', missing.join('; '));
  }

  const app = createAcceptancePublicAppV2({ pool, aiToken, gateToken, apiToken });
  const server = createServer(app);
  server.on('error', (err) => console.error('[acceptance-public][ALERT] listener error:', err.message));
  const host = process.env.ACCEPTANCE_PUBLIC_HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`[acceptance-public] listening on ${host}:${port}（三 token 分权：ai/gate/api）`);
  });
  return server;
}
