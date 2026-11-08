import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

const boundary = vi.hoisted(() => ({
  normalize: vi.fn(),
  write: vi.fn(),
  judge: vi.fn(),
  db: vi.fn(() => { throw new Error('Spans 鉴权回归禁止真实数据库调用'); }),
}));
vi.mock('../db.js', () => ({ default: { query: boundary.db, connect: boundary.db } }));
vi.mock('../lib/activity-judge.js', () => ({ onSpansWritten: boundary.judge }));
vi.mock('../lib/span-ingestion.js', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    normalizeSpan: (...args) => {
      boundary.normalize(...args);
      return actual.normalizeSpan(...args);
    },
    writeSpans: boundary.write,
  };
});

const TOKEN = 'owned-spans-auth-token';
const SPAN = {
  run_id: 'owned-spans-auth-run',
  activity_id: 'c1000000-0000-4000-8000-000000000001',
  started_at: '2026-11-06T00:00:00Z',
  executor_kind: 'code',
  outcome: 'pass',
  occurrence_key: 'owned-position-1',
};
const WRITTEN = { inserted: 1, skipped: 0, count: 1, ids: ['owned-span-id'] };
let router;
let savedEnv;

beforeAll(async () => {
  // 不 mock 鉴权：请求必须穿过实际 router 的完整中间件栈。
  router = (await import('./spans.js')).default;
});
beforeEach(() => {
  savedEnv = { NODE_ENV: process.env.NODE_ENV, CECELIA_INTERNAL_TOKEN: process.env.CECELIA_INTERNAL_TOKEN };
  vi.clearAllMocks();
  boundary.write.mockResolvedValue(WRITTEN);
});
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function postSpan(headers = {}) {
  const app = express();
  let peerAddress;
  app.use(express.json());
  app.use((req, _res, next) => { peerAddress = req.socket.remoteAddress; next(); });
  app.use('/api/brain', router);
  const server = await new Promise(resolve => {
    const owned = app.listen(0, '127.0.0.1', () => resolve(owned));
  });
  try {
    const result = await new Promise((resolve, reject) => {
      const body = JSON.stringify(SPAN);
      const request = http.request({
        host: '127.0.0.1', port: server.address().port,
        path: '/api/brain/spans', method: 'POST', agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers },
      }, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(text) }); }
          catch (error) { reject(error); }
        });
      });
      request.on('error', reject);
      request.setTimeout(2000, () => request.destroy(new Error('owned HTTP 超时')));
      request.end(body);
    });
    // 地址来自真实 socket，不用伪造 req.ip/socket 来模拟回环。
    expect(peerAddress).toBe('127.0.0.1');
    return result;
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

describe('POST /api/brain/spans 实际 HTTP 鉴权接线', () => {
  it.each([
    ['缺少凭据', {}],
    ['错误 X-Internal-Token', { 'x-internal-token': 'wrong-token' }],
    ['错误 Bearer', { authorization: 'Bearer wrong-token' }],
    ['伪造代理头', { 'x-forwarded-for': '127.0.0.1' }],
  ])('配置 token 后真实 loopback 也拒绝%s，且零写入/裁判', async (_name, headers) => {
    process.env.NODE_ENV = 'production';
    process.env.CECELIA_INTERNAL_TOKEN = TOKEN;
    const response = await postSpan(headers);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(boundary.normalize).not.toHaveBeenCalled();
    expect(boundary.write).not.toHaveBeenCalled();
    expect(boundary.judge).not.toHaveBeenCalled();
    expect(boundary.db).not.toHaveBeenCalled();
  });

  it('生产漏配 token 返回 503，即使真实来源为 loopback 也不写入', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CECELIA_INTERNAL_TOKEN;
    const response = await postSpan();
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('INTERNAL_AUTH_NOT_CONFIGURED');
    expect(boundary.normalize).not.toHaveBeenCalled();
    expect(boundary.write).not.toHaveBeenCalled();
    expect(boundary.judge).not.toHaveBeenCalled();
    expect(boundary.db).not.toHaveBeenCalled();
  });

  it.each([
    ['X-Internal-Token', 'production', TOKEN, { 'x-internal-token': TOKEN }],
    ['Bearer', 'production', TOKEN, { authorization: `Bearer ${TOKEN}` }],
    ['非生产漏配时的回环兼容', 'test', null, {}],
  ])('%s 穿过鉴权、真实归一化后才委托写入和裁判边界', async (_name, mode, token, headers) => {
    process.env.NODE_ENV = mode;
    if (token === null) delete process.env.CECELIA_INTERNAL_TOKEN;
    else process.env.CECELIA_INTERNAL_TOKEN = token;
    const response = await postSpan(headers);
    expect(response).toEqual({ status: 200, body: WRITTEN });
    expect(boundary.normalize).toHaveBeenCalledTimes(1);
    expect(boundary.write).toHaveBeenCalledTimes(1);
    const [pool, rows] = boundary.write.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].normalized).toMatchObject({ run_id: SPAN.run_id, activity_id: SPAN.activity_id, outcome: 'pass' });
    expect(rows[0].payload_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(boundary.judge).toHaveBeenCalledTimes(1);
    expect(boundary.judge).toHaveBeenCalledWith(pool, WRITTEN);
    expect(boundary.db).not.toHaveBeenCalled();
  });
});
