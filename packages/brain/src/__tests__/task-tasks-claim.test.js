/**
 * C1: POST /tasks/:id/claim 测试
 *
 * 覆盖 claim 冲突场景，不走 HTTP（mock pool + 构造 req/res）。
 * 参考 tasks-schema-normalize.test.js 的 handler 提取技巧。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const { mockQuery, mockReadTask, mockDb } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockReadTask = vi.fn();
  const query = vi.fn(async (sql, params) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (sql === 'SELECT id FROM tasks WHERE id=$1 FOR UPDATE') return { rows: [{ id: params[0] }] };
    // 退休判定的锁内预读不消费旧业务UPDATE/冲突查询的响应队列。
    if (sql === 'SELECT id, task_type, payload FROM tasks WHERE id=$1 FOR UPDATE') return mockReadTask(params[0]);
    if (/ AS native_owned$/.test(sql)) return { rows: [{ native_owned: false }] };
    if (sql === "SELECT payload->'headed_takeover' AS headed_takeover FROM tasks WHERE id=$1") return { rows: [{ headed_takeover: null }] };
    return mockQuery(sql, params);
  });
  const client = { query, release: vi.fn() };
  return { mockQuery, mockReadTask, mockDb: { query, connect: vi.fn(async () => client) } };
});
vi.mock('../db.js', () => ({ default: mockDb }));

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
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockReadTask.mockReset().mockImplementation(id => ({ rows: [{ id, task_type: 'data', payload: {} }] }));
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

  it('显式旧runner kind认领返回410，不覆盖claim也不写租约', async () => {
    const { req, res } = mockReqRes({ id: 'task-1' }, { claimer: 'cw', executor_kind: 'coding-workflow-runner', lease_seconds: 120 });
    await claimHandler(req, res);
    expect(res._status).toBe(410);
    expect(res._json.error).toBe('executor_kind_retired');
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('旧自主任务在锁内预读后拒绝，普通执行者也不能复活', async () => {
    mockReadTask.mockResolvedValueOnce({ rows: [{ id: 'retired', task_type: 'coding_workflow', payload: {} }] });
    const { req, res } = mockReqRes({ id: 'retired' }, { claimer: 'ordinary-agent', lease_seconds: 120 });
    await claimHandler(req, res);
    expect(res._status).toBe(410);
    expect(res._json.error).toBe('task_type_retired');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockDb.query.mock.calls.some(([sql]) => /UPDATE tasks|INSERT INTO task_leases/.test(sql))).toBe(false);
  });

  it('其他 kind（含缺省 headed-session）保持 COALESCE：不覆盖已有 executor_kind', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'task-1', claimed_by: 'r' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'task-2', claimed_by: 'r' }] });
    const first = mockReqRes({ id: 'task-1' }, { claimer: 'r', executor_kind: 'brain-local' });
    const second = mockReqRes({ id: 'task-2' }, { claimer: 'r' });
    await claimHandler(first.req, first.res);
    await claimHandler(second.req, second.res);
    expect(first.res._status).toBe(200);expect(second.res._status).toBe(200);
    for (const [sql] of mockQuery.mock.calls) expect(sql).toMatch(/ELSE COALESCE\(executor_kind, \$3\) END/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['r', 'task-1', 'brain-local', false]);
    expect(mockQuery.mock.calls[1][1]).toEqual(['r', 'task-2', 'headed-session', false]);
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

    await Promise.all([claimHandler(r1.req, r1.res), claimHandler(r2.req, r2.res)]);

    expect(r1.res._status).toBe(200);
    expect(r2.res._status).toBe(409);
    expect(r2.res._json.claimed_by).toBe('runner-A');
  });
});
