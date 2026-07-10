/**
 * T4 认领协议统一——task-tasks.js 两处协议补齐
 *
 * 1. POST /:id/claim — 接受可选 body.executor_kind（默认 headed-session）并写入 DB
 * 2. PATCH /:id — status → in_progress 时自动写 claimed_by COALESCE + executor_kind COALESCE
 *
 * 架构文档: docs/architecture/2026-07-10-executor-liveness-contract/architecture.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));
vi.mock('../domain-detector.js', () => ({
  detectDomain: () => ({ domain: 'agent_ops' }),
}));
vi.mock('../task-updater.js', () => ({ blockTask: vi.fn() }));
vi.mock('../quarantine.js', () => ({
  classifyFailure: vi.fn(),
  FAILURE_CLASS: { NETWORK: 'network', RATE_LIMIT: 'rate_limit', BILLING_CAP: 'billing_cap', AUTH: 'auth', RESOURCE: 'resource' },
}));

const { default: router } = await import('../routes/task-tasks.js');

function findHandler(method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error(`${method.toUpperCase()} ${path} handler not found in router`);
}

function mockReqRes(params, body, headers = {}) {
  const req = { params, body, headers };
  const res = {
    _status: 200,
    _json: null,
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; return this; },
  };
  return { req, res };
}

describe('POST /tasks/:id/claim — executor_kind 支持 (T4)', () => {
  const claimHandler = findHandler('post', '/:id/claim');

  beforeEach(() => mockQuery.mockReset());

  it('不传 executor_kind → 默认写入 headed-session', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-1', claimed_by: 'runner-A', claimed_at: '2026-07-10T00:00:00Z', executor_kind: 'headed-session' }],
    });

    const { req, res } = mockReqRes({ id: 'task-1' }, { claimer: 'runner-A' });
    await claimHandler(req, res);

    expect(res._status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/executor_kind/i);
    expect(params).toContain('headed-session');
  });

  it('传 executor_kind=bridge → 写入 bridge', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-2', claimed_by: 'bridge-runner', claimed_at: '2026-07-10T00:00:00Z', executor_kind: 'bridge' }],
    });

    const { req, res } = mockReqRes({ id: 'task-2' }, { claimer: 'bridge-runner', executor_kind: 'bridge' });
    await claimHandler(req, res);

    expect(res._status).toBe(200);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toContain('bridge');
  });

  it('传 executor_kind=brain-local → 写入 brain-local', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-3', claimed_by: 'brain', claimed_at: '2026-07-10T00:00:00Z', executor_kind: 'brain-local' }],
    });

    const { req, res } = mockReqRes({ id: 'task-3' }, { claimer: 'brain', executor_kind: 'brain-local' });
    await claimHandler(req, res);

    expect(res._status).toBe(200);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toContain('brain-local');
  });

  it('仍然要求 claimer 字段，缺少时 400', async () => {
    const { req, res } = mockReqRes({ id: 'task-4' }, { executor_kind: 'bridge' });
    await claimHandler(req, res);

    expect(res._status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('已被 claim 再 claim → 409（与原逻辑一致）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE 0 行
    mockQuery.mockResolvedValueOnce({
      rows: [{ claimed_by: 'runner-A', claimed_at: '2026-07-10T00:00:00Z' }],
    });

    const { req, res } = mockReqRes({ id: 'task-5' }, { claimer: 'runner-B' });
    await claimHandler(req, res);

    expect(res._status).toBe(409);
  });
});

describe('PATCH /tasks/:id — T4 in_progress 自动认领 (task-tasks.js)', () => {
  const patchHandler = findHandler('patch', '/:id');

  beforeEach(() => mockQuery.mockReset());

  it('status → in_progress 时 SQL 含 claimed_by COALESCE（有 X-Session-Id）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'queued' }] }) // 状态机检查 SELECT
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', status: 'in_progress' }] }); // UPDATE

    const { req, res } = mockReqRes(
      { id: 'task-1' },
      { status: 'in_progress' },
      { 'x-session-id': 'sess-xyz' },
    );
    await patchHandler(req, res);

    expect(res._status).toBe(200);
    const updateSql = mockQuery.mock.calls[1][0];
    expect(updateSql).toMatch(/claimed_by\s*=\s*COALESCE/i);
    const updateParams = mockQuery.mock.calls[1][1];
    const sessionParam = updateParams.find(p => typeof p === 'string' && p.startsWith('session:'));
    expect(sessionParam).toBe('session:sess-xyz');
  });

  it('status → in_progress 时 SQL 含 executor_kind COALESCE headed-session', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'queued' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-2', status: 'in_progress' }] });

    const { req, res } = mockReqRes({ id: 'task-2' }, { status: 'in_progress' });
    await patchHandler(req, res);

    expect(res._status).toBe(200);
    const updateSql = mockQuery.mock.calls[1][0];
    expect(updateSql).toMatch(/executor_kind\s*=\s*COALESCE/i);
    const updateParams = mockQuery.mock.calls[1][1];
    expect(updateParams).toContain('headed-session');
  });

  it('status → in_progress 无 X-Session-Id 时用 engine-patch', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'queued' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-3', status: 'in_progress' }] });

    const { req, res } = mockReqRes({ id: 'task-3' }, { status: 'in_progress' });
    await patchHandler(req, res);

    const updateParams = mockQuery.mock.calls[1][1];
    const sessionParam = updateParams.find(p => typeof p === 'string' && p.startsWith('session:'));
    expect(sessionParam).toBe('session:engine-patch');
  });

  it('status → completed 时不注入认领字段', async () => {
    const TERMINAL_STATUSES = ['completed', 'cancelled'];
    // task-tasks.js PATCH 终止状态机保护: completed 是终止状态不需要注入认领
    // 但 in_progress → completed 是允许的（非终止→终止）
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'in_progress' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-4', status: 'completed' }] });

    const { req, res } = mockReqRes({ id: 'task-4' }, { status: 'completed' });
    await patchHandler(req, res);

    expect(res._status).toBe(200);
    const updateSql = mockQuery.mock.calls[1][0];
    expect(updateSql).not.toMatch(/executor_kind\s*=\s*COALESCE/i);
  });

  it('回归哨兵：不传 status 时正常更新其他字段，不注入认领字段', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-5', priority: 'P1' }] });

    const { req, res } = mockReqRes({ id: 'task-5' }, { priority: 'P0' });
    await patchHandler(req, res);

    expect(res._status).toBe(200);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).not.toMatch(/executor_kind/i);
  });
});
