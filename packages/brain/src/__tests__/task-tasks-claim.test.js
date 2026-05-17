/**
 * C1: POST /tasks/:id/claim 测试
 *
 * 覆盖 claim 冲突场景，不走 HTTP（mock pool + 构造 req/res）。
 * 参考 tasks-schema-normalize.test.js 的 handler 提取技巧。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

// Mock domain-detector (route import chain)
vi.mock('../domain-detector.js', () => ({
  detectDomain: () => ({ domain: 'growth' }),
}));

// Mock task-updater
vi.mock('../task-updater.js', () => ({
  blockTask: vi.fn(),
}));

// Mock quarantine
vi.mock('../quarantine.js', () => ({
  classifyFailure: vi.fn(),
  FAILURE_CLASS: { NETWORK: 'network', RATE_LIMIT: 'rate_limit', BILLING_CAP: 'billing_cap', AUTH: 'auth', RESOURCE: 'resource' },
}));

// Import router to extract POST /:id/claim handler
const { default: router } = await import('../routes/task-tasks.js');

function findClaimHandler() {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === '/:id/claim' && layer.route.methods.post) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error('POST /:id/claim handler not found in router');
}

const claimHandler = findClaimHandler();

function mockReqRes(params, body) {
  const req = { params, body };
  const res = {
    _status: 200,
    _json: null,
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; return this; },
  };
  return { req, res };
}

describe('POST /tasks/:id/claim (C1)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('新 claim → 返回 200 + claimed_by/claimed_at', async () => {
    const claimedAt = '2026-04-17T17:00:00Z';
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-1', claimed_by: 'runner-alpha', claimed_at: claimedAt }],
    });

    const { req, res } = mockReqRes({ id: 'task-1' }, { claimer: 'runner-alpha' });
    await claimHandler(req, res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({ id: 'task-1', claimed_by: 'runner-alpha', claimed_at: claimedAt });
    // 第一次 UPDATE 应带 WHERE claimed_by IS NULL 保证原子性
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toMatch(/UPDATE tasks SET claimed_by/);
    expect(updateSql).toMatch(/claimed_by IS NULL/);
  });

  it('已被 claim 再 claim → 409 + 现有 claimed_by', async () => {
    // 第 1 次 query：UPDATE 返回 0 行
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 第 2 次 query：SELECT 查出现有 claimer
    mockQuery.mockResolvedValueOnce({
      rows: [{ claimed_by: 'runner-alpha', claimed_at: '2026-04-17T17:00:00Z' }],
    });

    const { req, res } = mockReqRes({ id: 'task-1' }, { claimer: 'runner-beta' });
    await claimHandler(req, res);

    expect(res._status).toBe(409);
    expect(res._json.error).toMatch(/already claimed/i);
    expect(res._json.claimed_by).toBe('runner-alpha');
  });

  it('无 claimer 参数 → 400', async () => {
    const { req, res } = mockReqRes({ id: 'task-1' }, {});
    await claimHandler(req, res);

    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/claimer/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('claim 不存在的 task → 404', async () => {
    // UPDATE 0 行 + SELECT 也 0 行
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { req, res } = mockReqRes({ id: 'missing-task' }, { claimer: 'runner-alpha' });
    await claimHandler(req, res);

    expect(res._status).toBe(404);
    expect(res._json.error).toMatch(/not found/i);
  });

  it('DB 抛异常 → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection lost'));

    const { req, res } = mockReqRes({ id: 'task-1' }, { claimer: 'runner-alpha' });
    await claimHandler(req, res);

    expect(res._status).toBe(500);
    expect(res._json.error).toMatch(/Failed to claim/i);
    expect(res._json.details).toMatch(/connection lost/);
  });

  it('两个 claimer 并发 claim 同一 task → 只有一个成功（通过 mock 模拟原子性）', async () => {
    // 第 1 个 runner：UPDATE 成功返回 1 行
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-1', claimed_by: 'runner-A', claimed_at: '2026-04-17T17:00:00Z' }],
    });
    // 第 2 个 runner：UPDATE 返回 0 行（已被 A claim）
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 第 2 个 runner SELECT 查出当前 claimer
    mockQuery.mockResolvedValueOnce({
      rows: [{ claimed_by: 'runner-A', claimed_at: '2026-04-17T17:00:00Z' }],
    });

    const r1 = mockReqRes({ id: 'task-1' }, { claimer: 'runner-A' });
    const r2 = mockReqRes({ id: 'task-1' }, { claimer: 'runner-B' });

    await claimHandler(r1.req, r1.res);
    await claimHandler(r2.req, r2.res);

    expect(r1.res._status).toBe(200);
    expect(r2.res._status).toBe(409);
    expect(r2.res._json.claimed_by).toBe('runner-A');
  });
});
