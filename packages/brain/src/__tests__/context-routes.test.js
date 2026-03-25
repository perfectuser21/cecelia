/**
 * context-routes.test.js
 * 覆盖 packages/brain/src/routes/context.js 三个路由端点
 *
 * 路由：
 *   GET  /context     — 聚合 OKR + 任务 + 决策
 *   GET  /okr/current — OKR 进度
 *   POST /consolidate — 触发 conversation-consolidator（fire-and-forget）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted 确保 mock 在 import 前注册
const { mockPool, mockRunConsolidator } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockRunConsolidator: vi.fn().mockResolvedValue({}),
}));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../conversation-consolidator.js', () => ({
  runConversationConsolidator: mockRunConsolidator,
}));

// 导入路由模块（mock 已就位）
import contextRouter from '../routes/context.js';

// ──────────────────────────────────────────────────────────────────────────────
// 轻量级 req/res 工厂，直接调用路由处理器（无 HTTP 层依赖）
// ──────────────────────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return { params: {}, query: {}, body: {}, ...overrides };
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
  return res;
}

/**
 * 从 Express Router 中提取指定 method + path 的处理函数
 */
function getHandler(router, method, routePath) {
  for (const layer of router.stack) {
    if (layer.route) {
      const { path: p, stack: rStack } = layer.route;
      if (p === routePath) {
        for (const rl of rStack) {
          if (rl.method === method.toLowerCase()) {
            return rl.handle;
          }
        }
      }
    }
  }
  throw new Error(`Handler not found: ${method} ${routePath}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// 测试套件
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('成功时返回 okr/tasks/decisions 聚合数据', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, type: 'objective', title: 'OKR1', status: 'active', progress: null, parent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 2, title: 'Task1', priority: 'P1', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: 3, ts: '2026-01-01', trigger: 'manual', input_summary: 'x', status: 'done' }] });

    const handler = getHandler(contextRouter, 'GET', '/context');
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toHaveProperty('okr');
    expect(res._body).toHaveProperty('tasks');
    expect(res._body).toHaveProperty('decisions');
    expect(res._body).toHaveProperty('generated_at');
    expect(Array.isArray(res._body.okr)).toBe(true);
    expect(Array.isArray(res._body.tasks)).toBe(true);
    expect(Array.isArray(res._body.decisions)).toBe(true);
  });

  it('DB 异常时返回 500', async () => {
    mockPool.query.mockRejectedValue(new Error('DB connection refused'));

    const handler = getHandler(contextRouter, 'GET', '/context');
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body).toHaveProperty('error');
    expect(res._body.details).toMatch(/DB connection refused/);
  });
});

describe('GET /okr/current', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('成功时返回 objectives + key_results', async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ id: 1, title: 'Obj A', status: 'active', metadata: null, active_krs: '2', total_krs: '3', avg_progress: '66' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 10, objective_id: 1, title: 'KR1', status: 'active', current_value: 66, target_value: 100, unit: '%', progress_pct: '66' }],
      });

    const handler = getHandler(contextRouter, 'GET', '/okr/current');
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toHaveProperty('objectives');
    expect(res._body).toHaveProperty('key_results');
    expect(res._body).toHaveProperty('generated_at');
    expect(Array.isArray(res._body.objectives)).toBe(true);
    expect(Array.isArray(res._body.key_results)).toBe(true);
  });

  it('DB 异常时返回 500', async () => {
    mockPool.query.mockRejectedValue(new Error('timeout'));

    const handler = getHandler(contextRouter, 'GET', '/okr/current');
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toMatch(/OKR/);
  });
});

describe('POST /consolidate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('立即返回 202 accepted（fire-and-forget）', async () => {
    const handler = getHandler(contextRouter, 'POST', '/consolidate');
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(202);
    expect(res._body).toHaveProperty('status', 'accepted');
    expect(res._body).toHaveProperty('message');
  });

  it('返回前不等待 consolidator 完成（异步 fire-and-forget）', async () => {
    let resolveConsolidator;
    mockRunConsolidator.mockReturnValue(
      new Promise(resolve => { resolveConsolidator = resolve; })
    );

    const handler = getHandler(contextRouter, 'POST', '/consolidate');
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    // 此时 consolidator 尚未完成，但 res 已经 202
    expect(res._status).toBe(202);

    // 清理：让 promise 完成
    resolveConsolidator({});
    await new Promise(r => setTimeout(r, 10));
  });
});
