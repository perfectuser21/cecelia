/**
 * claim-protocol.test.js — T4: 认领协议统一
 *
 * 覆盖三个 PATCH/claim 端点的 executor_kind + claimed_by 自动写入：
 *   A. routes/tasks.js PATCH /:task_id → in_progress
 *   B. routes/task-tasks.js POST /:id/claim (executor_kind 可选)
 *   C. routes/task-tasks.js PATCH /:id → in_progress
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('../../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../actions.js', () => ({ createTask: vi.fn(), updateTask: vi.fn() }));
vi.mock('../../tick-helpers.js', () => ({
  routeTask: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
}));
vi.mock('../../task-router.js', () => ({
  identifyWorkType: vi.fn(),
  getTaskLocation: vi.fn(),
  routeTaskCreate: vi.fn(),
  getValidTaskTypes: vi.fn().mockReturnValue([]),
  LOCATION_MAP: {},
  diagnoseKR: vi.fn(),
}));
vi.mock('../../task-weight.js', () => ({ getTaskWeights: vi.fn() }));
vi.mock('../../events/taskEvents.js', () => ({ publishTaskCreated: vi.fn() }));
vi.mock('../../executor.js', () => ({
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn(),
}));
vi.mock('../../quarantine.js', () => ({
  getQuarantinedTasks: vi.fn(),
  getQuarantineStats: vi.fn(),
  releaseTask: vi.fn(),
  quarantineTask: vi.fn(),
  QUARANTINE_REASONS: {},
  REVIEW_ACTIONS: {},
}));
vi.mock('../shared.js', () => ({ classifyLearningType: vi.fn() }));
vi.mock('../../domain-detector.js', () => ({ detectDomain: () => ({ domain: 'agent_ops' }) }));

let tasksRouter;
let taskTasksRouter;

beforeAll(async () => {
  const [modA, modB] = await Promise.all([
    import('../tasks.js'),
    import('../task-tasks.js'),
  ]);
  tasksRouter = modA.default;
  taskTasksRouter = modB.default;
});

function makeTasksApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', tasksRouter);
  return app;
}

function makeTaskTasksApp() {
  const app = express();
  app.use(express.json());
  app.use('/tasks', taskTasksRouter);
  return app;
}

// ─── A. tasks.js PATCH /:task_id ────────────────────────────────────────────

describe('A. tasks.js PATCH /:task_id → in_progress: 自动写 claimed_by + executor_kind', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = makeTasksApp();
  });

  function mockSelectOk(overrides = {}) {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-1',
        status: 'queued',
        claimed_by: null,
        executor_kind: null,
        ...overrides,
      }],
    });
  }

  function mockUpdateOk() {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ status: 'in_progress', updated_at: new Date().toISOString() }],
    });
  }

  it('status→in_progress 时 UPDATE SQL 含 COALESCE claimed_by', async () => {
    mockSelectOk();
    mockUpdateOk();
    const res = await request(app)
      .patch('/api/brain/tasks/task-1')
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    const updateCall = mockPool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('UPDATE tasks')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toMatch(/claimed_by/);
    expect(updateCall[0]).toMatch(/COALESCE/i);
  });

  it('status→in_progress 时 UPDATE 参数含 executor_kind=headed-session', async () => {
    mockSelectOk();
    mockUpdateOk();
    const res = await request(app)
      .patch('/api/brain/tasks/task-1')
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    const updateCall = mockPool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('UPDATE tasks')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toContain('headed-session');
  });

  it('X-Session-Id header 存在时 claimed_by 使用 session:{id}', async () => {
    mockSelectOk();
    mockUpdateOk();
    const res = await request(app)
      .patch('/api/brain/tasks/task-1')
      .set('X-Session-Id', 'abc123')
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    const updateCall = mockPool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('UPDATE tasks')
    );
    expect(updateCall[1]).toContain('session:abc123');
  });

  it('X-Session-Id 缺失时 fallback 为 session:engine-patch', async () => {
    mockSelectOk();
    mockUpdateOk();
    const res = await request(app)
      .patch('/api/brain/tasks/task-1')
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    const updateCall = mockPool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('UPDATE tasks')
    );
    expect(updateCall[1]).toContain('session:engine-patch');
  });

  it('blocked 有头账本恢复须先由真实执行者 claim，PATCH 不得占成 session:engine-patch', async () => {
    mockSelectOk({
      status: 'blocked',
      claimed_by: null,
      executor_kind: 'headed-session',
      payload: { headed_manual: true },
    });
    const res = await request(app)
      .patch('/api/brain/tasks/task-1')
      .send({ status: 'in_progress' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CLAIM_REQUIRED_FOR_BLOCKED_RECOVERY');
    expect(mockPool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks'))).toBe(false);
  });

  it('blocked 有头账本已由真实执行者 claim 后可恢复且保留 owner', async () => {
    mockSelectOk({
      status: 'blocked',
      claimed_by: 'codex:104-exact-order-scope',
      executor_kind: 'headed-session',
      payload: { headed_manual: true },
    });
    mockUpdateOk();
    const res = await request(app)
      .patch('/api/brain/tasks/task-1')
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(mockPool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks'))).toBe(true);
  });

  it('status→completed 时 UPDATE 不写 executor_kind 列', async () => {
    mockSelectOk({ status: 'in_progress', claimed_by: 'session:x', executor_kind: 'headed-session' });
    mockUpdateOk();
    // KR 계산 체인 mock (best-effort, 실패해도 OK)
    mockPool.query.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .patch('/api/brain/tasks/task-1')
      .send({ status: 'completed' });
    expect([200, 500]).toContain(res.status); // KR 체인은 best-effort
    const updateCall = mockPool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('UPDATE tasks SET')
    );
    expect(updateCall).toBeDefined();
    // completed 时不写 executor_kind
    const sqlParts = updateCall[0].split('WHERE')[0];
    expect(sqlParts).not.toMatch(/executor_kind\s*=\s*\$/);
  });
});

// ─── B. task-tasks.js POST /:id/claim ───────────────────────────────────────

describe('B. task-tasks.js POST /:id/claim: executor_kind 写入', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = makeTaskTasksApp();
  });

  it('claim 不传 executor_kind → 默认写 headed-session', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-2', claimed_by: 'agent-1', claimed_at: new Date().toISOString() }],
    });
    const res = await request(app)
      .post('/tasks/task-2/claim')
      .send({ claimer: 'agent-1' });
    expect(res.status).toBe(200);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/executor_kind/);
    expect(params).toContain('headed-session');
  });

  it('claim 传入 executor_kind=bridge → 写 bridge', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-3', claimed_by: 'bridge-1', claimed_at: new Date().toISOString() }],
    });
    const res = await request(app)
      .post('/tasks/task-3/claim')
      .send({ claimer: 'bridge-1', executor_kind: 'bridge' });
    expect(res.status).toBe(200);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/executor_kind/);
    expect(params).toContain('bridge');
  });
});

describe('B2. POST /:id/claim 带 lease_seconds（统一领单租约，任务 c5f6e683）', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = makeTaskTasksApp();
  });

  it('lease_seconds → 认领后落租约行，响应带 lease_until', async () => {
    const until = new Date(Date.now() + 120_000).toISOString();
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-9', claimed_by: 'fd', claimed_at: new Date().toISOString(), executor_kind: 'openclaw-agent' }] })
      .mockResolvedValueOnce({ rows: [{ lease_until: until, lease_seconds: 120, on_expire: 'auto' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .post('/tasks/task-9/claim')
      .send({ claimer: 'fd', executor_kind: 'openclaw-agent', lease_seconds: 120 });
    expect(res.status).toBe(200);
    expect(res.body.lease_until).toBe(until);
    const lease = mockPool.query.mock.calls.find(([sql]) => /INSERT INTO task_leases/.test(sql));
    expect(lease).toBeTruthy();
    expect(lease[1]).toContain(120);
  });

  it('非法 on_lease_expire → 400，不认领', async () => {
    const res = await request(app)
      .post('/tasks/task-9/claim')
      .send({ claimer: 'fd', lease_seconds: 120, on_lease_expire: 'boom' });
    expect(res.status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});

// ─── C. task-tasks.js PATCH /:id → in_progress ──────────────────────────────


describe('C. task-tasks.js PATCH /:id → in_progress: 补写 claimed_by + executor_kind', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = makeTaskTasksApp();
  });

  it('PATCH status→in_progress 时 UPDATE SQL 含 executor_kind', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ status: 'queued' }] }) // SELECT status
      .mockResolvedValueOnce({ rows: [{ id: 'task-4', status: 'in_progress' }] }); // UPDATE
    const res = await request(app)
      .patch('/tasks/task-4')
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    const updateCall = mockPool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('UPDATE tasks')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toMatch(/executor_kind/);
    expect(updateCall[1]).toContain('headed-session');
  });

  it('PATCH status→in_progress 时 UPDATE SQL 含 claimed_by COALESCE', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ status: 'queued' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-5', status: 'in_progress' }] });
    const res = await request(app)
      .patch('/tasks/task-5')
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    const updateCall = mockPool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('UPDATE tasks')
    );
    expect(updateCall[0]).toMatch(/claimed_by/);
    expect(updateCall[0]).toMatch(/COALESCE/i);
  });

  it('blocked 有头账本也不能由通用 PATCH 抢先填充占位 owner', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{
      status: 'blocked', claimed_by: null, payload: { headed_manual: true },
    }] });
    const res = await request(app)
      .patch('/tasks/task-5')
      .send({ status: 'in_progress' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CLAIM_REQUIRED_FOR_BLOCKED_RECOVERY');
    expect(mockPool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks'))).toBe(false);
  });
});
