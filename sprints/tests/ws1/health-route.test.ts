/**
 * Workstream 1 — Health Route Module [BEHAVIOR]
 *
 * 覆盖 contract-draft.md:
 *  - Feature 1: 契约形状（5 个 it）
 *  - Feature 2: DB / tick / 外部依赖零耦合（4 个 it）
 *
 * 预期 Red（round 1）：`packages/brain/src/routes/health.js` 尚不存在，
 * 动态 import 失败 → 该文件所有 it() 全部 FAIL。
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// ── Mock 注入：db.js 的 pool.query 必须是 spy，handler 一旦调用就会被记录 ──
const mockPoolQuery = vi.fn().mockRejectedValue(new Error('db down (should never be called)'));
vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: mockPoolQuery },
}));

// ── Mock tick.js 的 getTickStatus，同理 spy ──
const mockGetTickStatus = vi.fn().mockRejectedValue(new Error('tick down (should never be called)'));
vi.mock('../../../packages/brain/src/tick.js', () => ({
  getTickStatus: mockGetTickStatus,
  initTickLoop: vi.fn(),
  startTick: vi.fn(),
  stopTick: vi.fn(),
}));

let router: any;
let app: Express;

beforeAll(async () => {
  const mod = await import('../../../packages/brain/src/routes/health.js');
  router = (mod as any).default;
  app = express();
  app.use(express.json());
  app.use('/', router);
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
    expect(res.body.status).toBe('ok');
  });

  it('returns uptime_seconds as a non-negative number', async () => {
    const res = await request(app).get('/');
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(Number.isFinite(res.body.uptime_seconds)).toBe(true);
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it('returns version as a non-empty string', async () => {
    const res = await request(app).get('/');
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version.length).toBeGreaterThan(0);
  });

  it('responds with application/json content-type', async () => {
    const res = await request(app).get('/');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

describe('Workstream 1 — DB / Tick Zero Coupling [BEHAVIOR]', () => {
  it('does not invoke pg pool query during request handling', async () => {
    mockPoolQuery.mockClear();
    await request(app).get('/');
    expect(mockPoolQuery).toHaveBeenCalledTimes(0);
  });

  it('does not invoke getTickStatus during request handling', async () => {
    mockGetTickStatus.mockClear();
    await request(app).get('/');
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
