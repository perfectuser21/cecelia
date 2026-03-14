/**
 * Tests for GET /api/brain/cortex/stats route
 *
 * 覆盖：
 * 1. 正常返回 24h 统计数据（total_calls, timeout_rate_pct, avg_response_ms 等）
 * 2. hours 参数限制（默认 24，最大 168，最小 1）
 * 3. DB 查询失败时返回 500
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ── Mocks（必须在 import routes.js 之前） ─────────────────────────────────────

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../db.js', () => ({ default: mockPool }));

// 屏蔽 routes.js 的其他重依赖，避免副作用
vi.mock('../decomposition-checker.js', () => ({ runDecompositionChecks: vi.fn() }));
vi.mock('../cortex.js', () => ({
  analyzeDeep: vi.fn(),
  performRCA: vi.fn(),
  generateSystemReport: vi.fn(),
  callCortexLLM: vi.fn(),
}));
vi.mock('../thalamus.js', () => ({
  ACTION_WHITELIST: {},
  validateDecision: vi.fn(),
  recordLLMError: vi.fn(),
  recordTokenUsage: vi.fn(),
  analyzeEvent: vi.fn(),
}));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));

// ── 加载 router ────────────────────────────────────────────────────────────────

let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../routes.js');
  router = mod.default;
});

// ── 辅助 ──────────────────────────────────────────────────────────────────────

function getHandler(method, path) {
  const layers = router.stack.filter(
    l => l.route && l.route.methods[method] && l.route.path === path
  );
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

function mockReqRes(query = {}) {
  const req = { query };
  const res = {
    _status: 200,
    _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}

/** 构造 decision_log 查询结果的 mock 行 */
function makeStatsRow({
  total_calls = '10',
  timeout_count = '2',
  timeout_rate_pct = '20.00',
  avg_response_ms = '3500',
  max_response_ms = '9800',
  avg_prompt_tokens_est = '512',
} = {}) {
  return {
    rows: [{ total_calls, timeout_count, timeout_rate_pct, avg_response_ms, max_response_ms, avg_prompt_tokens_est }],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /cortex/stats', () => {
  let handler;

  beforeAll(() => {
    handler = getHandler('get', '/cortex/stats');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常响应', () => {
    it('返回 success:true 和统计字段', async () => {
      mockPool.query.mockResolvedValueOnce(makeStatsRow());
      const { req, res } = mockReqRes();

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data).toHaveProperty('total_calls');
      expect(res._data).toHaveProperty('timeout_count');
      expect(res._data).toHaveProperty('timeout_rate_pct');
      expect(res._data).toHaveProperty('avg_response_ms');
      expect(res._data).toHaveProperty('max_response_ms');
      expect(res._data).toHaveProperty('avg_prompt_tokens_est');
    });

    it('默认 period_hours = 24', async () => {
      mockPool.query.mockResolvedValueOnce(makeStatsRow());
      const { req, res } = mockReqRes();

      await handler(req, res);

      expect(res._data.period_hours).toBe(24);
    });

    it('正确解析数值字段', async () => {
      mockPool.query.mockResolvedValueOnce(makeStatsRow({
        total_calls: '10',
        timeout_count: '2',
        timeout_rate_pct: '20.00',
        avg_response_ms: '3500',
        max_response_ms: '9800',
        avg_prompt_tokens_est: '512',
      }));
      const { req, res } = mockReqRes();

      await handler(req, res);

      expect(res._data.total_calls).toBe(10);
      expect(res._data.timeout_count).toBe(2);
      expect(res._data.timeout_rate_pct).toBe(20);
      expect(res._data.avg_response_ms).toBe(3500);
      expect(res._data.max_response_ms).toBe(9800);
      expect(res._data.avg_prompt_tokens_est).toBe(512);
    });

    it('avg_response_ms 为 null 时返回 null', async () => {
      mockPool.query.mockResolvedValueOnce(makeStatsRow({ avg_response_ms: null }));
      const { req, res } = mockReqRes();

      await handler(req, res);

      expect(res._data.avg_response_ms).toBeNull();
    });
  });

  describe('hours 参数', () => {
    it('?hours=48 → period_hours=48', async () => {
      mockPool.query.mockResolvedValueOnce(makeStatsRow());
      const { req, res } = mockReqRes({ hours: '48' });

      await handler(req, res);

      expect(res._data.period_hours).toBe(48);
      const [, params] = mockPool.query.mock.calls[0];
      expect(params[0]).toBe(48);
    });

    it('?hours=0 → 下限修正为 1', async () => {
      mockPool.query.mockResolvedValueOnce(makeStatsRow());
      const { req, res } = mockReqRes({ hours: '0' });

      await handler(req, res);

      expect(res._data.period_hours).toBe(1);
    });

    it('?hours=999 → 上限截断为 168', async () => {
      mockPool.query.mockResolvedValueOnce(makeStatsRow());
      const { req, res } = mockReqRes({ hours: '999' });

      await handler(req, res);

      expect(res._data.period_hours).toBe(168);
    });
  });

  describe('DB 失败', () => {
    it('pool.query 抛出异常时返回 500', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));
      const { req, res } = mockReqRes();

      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.error).toMatch(/DB connection lost/);
    });
  });
});
