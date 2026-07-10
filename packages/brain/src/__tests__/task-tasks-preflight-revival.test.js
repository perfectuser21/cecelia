/**
 * TDD: pre-flight 三振复活路径
 *
 * PATCH /tasks/:id 补 description 时，若任务是 blocked+pre_flight_rejected，
 * 应自动回 queued 并清零 pre_flight_fail_count。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

vi.mock('../domain-detector.js', () => ({
  detectDomain: () => ({ domain: 'growth' }),
}));

vi.mock('../task-updater.js', () => ({
  blockTask: vi.fn(),
}));

vi.mock('../quarantine.js', () => ({
  classifyFailure: vi.fn(),
  FAILURE_CLASS: { NETWORK: 'network', RATE_LIMIT: 'rate_limit', BILLING_CAP: 'billing_cap', AUTH: 'auth', RESOURCE: 'resource' },
}));

const { default: router } = await import('../routes/task-tasks.js');

function findPatchHandler() {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === '/:id' && layer.route.methods.patch) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error('PATCH /:id handler not found');
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

describe('PATCH /tasks/:id — pre-flight 三振复活路径', () => {
  let handler;
  beforeEach(() => {
    vi.clearAllMocks();
    handler = findPatchHandler();
  });

  it('blocked+pre_flight_rejected 任务补 description 后自动回 queued 并清零计数', async () => {
    const taskId = 'task-blocked-revival';
    const blockedTask = {
      status: 'blocked',
      blocked_reason: 'pre_flight_rejected',
      metadata: { pre_flight_fail_count: 3, pre_flight_failed: true, pre_flight_issues: ['description is empty'] }
    };

    // 查询 status（状态机保护用，无 status in body，不触发此查）
    // 查询 current task for revival check
    mockQuery.mockResolvedValueOnce({ rows: [blockedTask] }); // SELECT status, blocked_reason, metadata
    // UPDATE RETURNING
    mockQuery.mockResolvedValueOnce({ rows: [{ id: taskId, status: 'queued', description: '补充的描述内容' }] });

    const req = {
      params: { id: taskId },
      body: { description: '补充的描述内容' },
    };
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.status).toBe('queued');

    // UPDATE SQL 必须包含 status = 'queued' 和 description
    const updateCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].startsWith('UPDATE tasks SET')
    );
    expect(updateCall).toBeDefined();
    const sql = updateCall[0];
    expect(sql).toContain("status = 'queued'");
    expect(sql).toContain('description');

    // metadata 参数必须不含 pre_flight_fail_count
    const metaParam = updateCall[1].find(a => {
      try { const p = JSON.parse(a); return typeof p === 'object' && p !== null; } catch { return false; }
    });
    if (metaParam) {
      const meta = JSON.parse(metaParam);
      expect(meta.pre_flight_fail_count).toBeUndefined();
    }
  });

  it('non-blocked 任务补 description 不触发复活逻辑', async () => {
    const taskId = 'task-queued-normal';

    // 不需要 SELECT（无 status in body + description 不触发 status 机保护查询）
    // revival 检查
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'queued', blocked_reason: null, metadata: null }] });
    // UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [{ id: taskId, status: 'queued', description: '正常描述' }] });

    const req = {
      params: { id: taskId },
      body: { description: '正常描述' },
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const updateCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].startsWith('UPDATE tasks SET')
    );
    const sql = updateCall[0];
    // 不应该包含 status 回 queued 的逻辑（任务本来已是 queued）
    expect(sql).not.toContain("status = 'queued'");
  });

  it('blocked_reason 不是 pre_flight_rejected 时 description 更新不触发复活', async () => {
    const taskId = 'task-other-blocked';

    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'blocked', blocked_reason: 'manual_block', metadata: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: taskId, status: 'blocked', description: '补充描述' }] });

    const req = {
      params: { id: taskId },
      body: { description: '补充描述' },
    };
    const res = makeRes();
    await handler(req, res);

    const updateCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].startsWith('UPDATE tasks SET')
    );
    const sql = updateCall[0];
    expect(sql).not.toContain("status = 'queued'");
    expect(sql).not.toContain('blocked_reason = NULL');
  });
});
