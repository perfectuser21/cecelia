/**
 * dev-pipeline-health.test.js
 * 测试 GET /api/brain/dev-pipeline/success-rate
 * 测试 GET /api/brain/dev-pipeline/health
 *
 * 遵循 routes.test.js 的极简 mock 策略：只 mock db.js + dispatch-stats.js
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// 只 mock 必要的依赖（参考 routes.test.js 的极简策略）
// hoisted 确保 routes.js 加载时获得同一 mockPool 实例
const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

vi.mock('../dispatch-stats.js', () => ({
  getDispatchStats: vi.fn(),
  recordDispatchResult: vi.fn(),
  DISPATCH_STATS_KEY: 'dispatch_stats',
  WINDOW_MS: 3600000,
  DISPATCH_RATE_THRESHOLD: 0.3,
  DISPATCH_MIN_SAMPLE: 10,
}));

import { getDispatchStats } from '../dispatch-stats.js';

// pool 引用直接用 mockPool（不再 static import）
const pool = mockPool;

// isolate:false 修复：不在顶层 await import，改为 beforeAll + vi.resetModules()
let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../routes.js');
  router = mod.default;
});

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

function getHandler(method, path) {
  const layers = router.stack.filter(
    l => l.route && l.route.methods[method] && l.route.path === path
  );
  if (layers.length === 0) throw new Error(`No handler for ${method.toUpperCase()} ${path}`);
  return layers[0].route.stack[layers[0].route.stack.length - 1].handle;
}

function makeMockRes() {
  const res = {
    _status: 200,
    _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return res;
}

// ─── 测试：success-rate ───────────────────────────────────────────────────────

describe('GET /dev-pipeline/success-rate', () => {
  let handler;
  beforeAll(() => { handler = getHandler('get', '/dev-pipeline/success-rate'); });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常返回 window_1h + lifetime', async () => {
    getDispatchStats.mockResolvedValueOnce({
      window_1h: { total: 10, success: 8, failed: 2, rate: 0.8, last_updated: '2026-01-01T00:00:00Z' },
    });
    pool.query.mockResolvedValueOnce({
      rows: [{ total: '50', completed: '40', with_pr: '35' }],
    });

    const req = {};
    const res = makeMockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._data.window_1h.rate).toBe(0.8);
    expect(res._data.lifetime.total).toBe(50);
    expect(res._data.lifetime.completed).toBe(40);
    expect(res._data.lifetime.with_pr).toBe(35);
    expect(res._data.lifetime.success_rate).toBeCloseTo(35 / 50);
  });

  it('total=0 时 success_rate 为 null', async () => {
    getDispatchStats.mockResolvedValueOnce({
      window_1h: { total: 0, success: 0, failed: 0, rate: null },
    });
    pool.query.mockResolvedValueOnce({
      rows: [{ total: '0', completed: '0', with_pr: '0' }],
    });

    const req = {};
    const res = makeMockRes();
    await handler(req, res);

    expect(res._data.lifetime.success_rate).toBeNull();
  });

  it('DB 错误时返回 500', async () => {
    getDispatchStats.mockResolvedValueOnce({ window_1h: {} });
    pool.query.mockRejectedValueOnce(new Error('DB down'));

    const req = {};
    const res = makeMockRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._data.error).toMatch(/Failed/);
  });
});

// ─── 测试：health ─────────────────────────────────────────────────────────────

describe('GET /dev-pipeline/health', () => {
  let handler;
  beforeAll(() => { handler = getHandler('get', '/dev-pipeline/health'); });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回结构包含 healthy + checks 四项', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ typed: '5', total: '10' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '3' }] });

    const req = {};
    const res = makeMockRes();
    await handler(req, res);

    expect(res._data.healthy).toBeDefined();
    const { checks } = res._data;
    expect(Object.keys(checks)).toEqual(
      expect.arrayContaining(['task_generator', 'executor', 'pr_callback', 'retry'])
    );
  });

  it('task_generator 全 null 时 status=fail, healthy=false', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ typed: '0', total: '10' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '2' }] });

    const req = {};
    const res = makeMockRes();
    await handler(req, res);

    expect(res._data.checks.task_generator.status).toBe('fail');
    expect(res._data.healthy).toBe(false);
  });

  it('近期无 PR 合并时 pr_callback=warn', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ typed: '10', total: '10' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    const req = {};
    const res = makeMockRes();
    await handler(req, res);

    expect(res._data.checks.pr_callback.status).toBe('warn');
  });

  it('无任务时 task_generator=warn', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ typed: '0', total: '0' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '1' }] });

    const req = {};
    const res = makeMockRes();
    await handler(req, res);

    expect(res._data.checks.task_generator.status).toBe('warn');
  });
});
