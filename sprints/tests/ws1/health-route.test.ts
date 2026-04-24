/**
 * Workstream 1 — Health Route Module [BEHAVIOR]
 *
 * 覆盖 contract-draft.md:
 *  - Feature 1: 契约形状（5 个 it）
 *  - Feature 2: DB / tick / 外部依赖零耦合（4 个 it）
 *
 * Round 2 强化（Reviewer 反馈 #4 断言级 Red）：
 *   beforeAll 用 try/catch 吞掉 import 错误，import 失败时 router=null、
 *   app 正常构造但不挂路由。这样每个 it 都能"进入执行"并在断言行 FAIL，
 *   而不是 suite 在模块解析阶段整体挂掉（"suite 不进入执行"不计入 red 证据）。
 *
 *   Generator 禁止用空 stub 绕过：Contract 的断言（status===200、恰好三键、
 *   status==='ok'、typeof === 'number'、单调递增、POST→404/405 等）无法用
 *   "返回空对象""返回 {}""永远 204"之类的假实现通过。
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const mockPoolQuery = vi.fn().mockRejectedValue(new Error('db down (should never be called)'));
vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: mockPoolQuery },
}));

const mockGetTickStatus = vi.fn().mockRejectedValue(new Error('tick down (should never be called)'));
vi.mock('../../../packages/brain/src/tick.js', () => ({
  getTickStatus: mockGetTickStatus,
  initTickLoop: vi.fn(),
  startTick: vi.fn(),
  stopTick: vi.fn(),
}));

let router: any = null;
let app: Express;
let importError: Error | null = null;

beforeAll(async () => {
  try {
    const mod = await import('../../../packages/brain/src/routes/health.js');
    router = (mod as any).default;
  } catch (e) {
    importError = e as Error;
    router = null;
  }
  app = express();
  app.use(express.json());
  if (router) {
    app.use('/', router);
  }
});

describe('Workstream 1 — Health Route Contract Shape [BEHAVIOR]', () => {
  it('returns HTTP 200 with only status/uptime_seconds/version keys', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['status', 'uptime_seconds', 'version']);
  });

  it('returns status equal to literal string "ok"', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns uptime_seconds as a non-negative number', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(Number.isFinite(res.body.uptime_seconds)).toBe(true);
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it('returns version as a non-empty string', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version.length).toBeGreaterThan(0);
  });

  it('responds with application/json content-type', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

describe('Workstream 1 — DB / Tick Zero Coupling [BEHAVIOR]', () => {
  it('does not invoke pg pool query during request handling', async () => {
    mockPoolQuery.mockClear();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(mockPoolQuery).toHaveBeenCalledTimes(0);
  });

  it('does not invoke getTickStatus during request handling', async () => {
    mockGetTickStatus.mockClear();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(mockGetTickStatus).toHaveBeenCalledTimes(0);
  });

  it('still returns 200 with full shape when pg pool rejects', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('db outage simulated'));
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['status', 'uptime_seconds', 'version']);
  });

  it('completes within 500ms even under rejecting pg pool', async () => {
    mockPoolQuery.mockRejectedValue(new Error('db outage simulated'));
    const start = Date.now();
    const res = await request(app).get('/');
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
  });
});
