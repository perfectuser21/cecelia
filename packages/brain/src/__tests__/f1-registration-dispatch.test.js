/**
 * f1-registration-dispatch — F1 接单失守三联 bug 回归测试（task 8419142d）
 *
 * TC-A: POST /api/brain/tasks 携带 status=blocked → DB 写入 blocked，blocked_at 非 null
 * TC-B: dispatcher 遇 blocked 任务 → selectNextDispatchableTask 不选它（只选 queued）
 * TC-C: 同 task_id 在途容器（initiative_runs 非终态）→ spawn 被拒，reason=active_run_guard
 * TC-REG: 注册序列 1 queued + 2 blocked → 仅首个被选中派发
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── TC-A / TC-REG 公共 mock（task-tasks 路由层）───────────────────────────
const queryMock = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => queryMock(...a) } }));

vi.mock('../domain-detector.js', () => ({
  detectDomain: () => ({ domain: 'growth' }),
}));
vi.mock('../task-updater.js', () => ({ blockTask: vi.fn() }));
vi.mock('../quarantine.js', () => ({
  classifyFailure: vi.fn(),
  FAILURE_CLASS: {
    NETWORK: 'network', RATE_LIMIT: 'rate_limit', BILLING_CAP: 'billing_cap',
    AUTH: 'auth', RESOURCE: 'resource',
  },
}));

const { default: taskTasksRouter } = await import('../routes/task-tasks.js');
const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/tasks', taskTasksRouter);
  return app;
}

// INSERT SQL 成功返回（根据 status 动态构造返回行）
function makeInsertResult(status = 'queued', blockedAt = null) {
  return {
    rows: [{
      id: 'task-new-001',
      title: 'test task',
      status,
      task_type: 'dev',
      priority: 'P2',
      payload: {},
      created_at: '2026-08-05T00:00:00Z',
      blocked_at: blockedAt,
    }],
  };
}

// ─── TC-A：POST /api/brain/tasks 携带 status=blocked → DB 写入 blocked ──────
describe('TC-A: POST /tasks status=blocked 注册', () => {
  beforeEach(() => {
    queryMock.mockReset();
    // 第 1 次：dedup SELECT 返回空（无重复），第 2 次：INSERT 返回
    queryMock
      .mockResolvedValueOnce({ rows: [] })  // dedup 查询
      .mockImplementation(async (sql, params) => {
        if (/INSERT INTO tasks/i.test(sql)) {
          return makeInsertResult('blocked', new Date().toISOString());
        }
        return { rows: [] };
      });
  });

  it('TC-A-1: 携带 status=blocked 时，INSERT 的 $5 参数应为 "blocked"', async () => {
    let capturedParams = null;
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // dedup
      .mockImplementation(async (sql, params) => {
        if (/INSERT INTO tasks/i.test(sql)) {
          capturedParams = params;
          return makeInsertResult('blocked', new Date().toISOString());
        }
        return { rows: [] };
      });

    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '被阻断任务', status: 'blocked' });

    // 断言：HTTP 成功（201）
    expect(res.status).toBe(201);

    // 断言：INSERT params 中 status 位置（$5）应为 'blocked'，不能被改成 'queued'
    // params 顺序：title, description, priority, task_type, status, project_id, ...
    expect(capturedParams).not.toBeNull();
    const statusParam = capturedParams[4]; // $5 = index 4
    expect(statusParam).toBe('blocked'); // ← 当前代码 FAIL：会变成 'queued'
  });

  it('TC-A-2: 携带 status=blocked 时，INSERT SQL 必须含 blocked_at 字段', async () => {
    let capturedSql = null;
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // dedup
      .mockImplementation(async (sql, params) => {
        if (/INSERT INTO tasks/i.test(sql)) {
          capturedSql = sql;
          return makeInsertResult('blocked', new Date().toISOString());
        }
        return { rows: [] };
      });

    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '被阻断任务B', status: 'blocked' });

    expect(res.status).toBe(201);

    // 断言：INSERT SQL 中含 blocked_at 列
    expect(capturedSql).not.toBeNull();
    expect(capturedSql).toMatch(/blocked_at/i); // ← 当前代码 FAIL：INSERT 无 blocked_at
  });

  it('TC-A-3: status=queued 正常注册（回归保护，不得破坏）', async () => {
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // dedup
      .mockResolvedValueOnce(makeInsertResult('queued'));

    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '普通任务' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('queued');
  });

  it('TC-A-4: status=pending_postdeploy 正常注册（回归保护，不得破坏）', async () => {
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // dedup
      .mockResolvedValueOnce(makeInsertResult('pending_postdeploy'));

    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '部署后任务', status: 'pending_postdeploy' });

    expect(res.status).toBe(201);
  });
});

// ─── TC-C：双容器竞态 — initiative_runs 非终态时拒绝二次 spawn ───────────────
describe('TC-C: 双容器幂等防重 (active_run_guard)', () => {
  it('TC-C-1: initiative_runs 存在非终态行 → spawn 被拒绝，reason=active_run_guard', async () => {
    // mock dbPool：initiative_runs 查询返回一行（存在活跃 run）
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (/initiative_runs/.test(sql) && /phase NOT IN/.test(sql)) {
          return { rows: [{ id: 'existing-run-id' }] };
        }
        return { rows: [] };
      }),
    };

    const mockSpawnFn = vi.fn().mockResolvedValue({ ok: true });
    const mockExecFn = vi.fn().mockReturnValue(''); // docker ps 返回空（无 live container）

    const task = {
      id: 'task-duplicate-001',
      task_type: 'harness_initiative',
      location: 'us',
      payload: { orchestrator: 'skill-relay', executor: 'claude' },
    };

    const result = await spawnSkillRelaySession(task, {
      pool: mockPool,
      spawnFn: mockSpawnFn,
      execFn: mockExecFn,
      loadSkill: () => 'skill content',
      ensureWt: async () => '/tmp/wt',
      tokenFn: async () => 'gh-token',
    });

    // 断言：被拒绝且 reason=active_run_guard
    expect(result.ok).toBe(false); // ← 当前代码 FAIL：不存在此守卫，会放行
    expect(result.reason).toBe('active_run_guard'); // ← 当前代码 FAIL

    // 断言：spawnFn 未被调用（没有二次 spawn）
    expect(mockSpawnFn).not.toHaveBeenCalled(); // ← 当前代码 FAIL：会调用 spawn
  });

  it('TC-C-2: initiative_runs 无非终态行 → 正常放行（不误阻）', async () => {
    let dbCallCount = 0;
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (/initiative_runs/.test(sql) && /phase NOT IN/.test(sql)) {
          return { rows: [] }; // 无活跃 run → 放行
        }
        // 后续 DB 操作（INSERT initiative_runs 等）
        dbCallCount++;
        return { rows: [{ id: 'new-run-id' }] };
      }),
    };

    const mockSpawnFn = vi.fn().mockResolvedValue({ ok: true, containerId: 'container-123' });
    const mockExecFn = vi.fn().mockReturnValue(''); // docker ps 空

    const task = {
      id: 'task-fresh-001',
      task_type: 'harness_initiative',
      location: 'us',
      payload: { orchestrator: 'skill-relay', executor: 'claude' },
    };

    // TC-C-2 只验证：守卫查询本身不误阻（不要求 spawn 完全成功，因为还有其他依赖）
    // 关键：不应因为 active_run_guard 而被拒
    const result = await spawnSkillRelaySession(task, {
      pool: mockPool,
      spawnFn: mockSpawnFn,
      execFn: mockExecFn,
      loadSkill: () => 'skill content',
      ensureWt: async () => '/tmp/wt',
      tokenFn: async () => 'gh-token',
    });

    // 不得因 active_run_guard 拒绝
    expect(result.reason).not.toBe('active_run_guard');
  });

  it('TC-C-3: DB 守门查询失败 → 保守通过（fail-open）', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (/initiative_runs/.test(sql) && /phase NOT IN/.test(sql)) {
          throw new Error('DB connection error');
        }
        return { rows: [{ id: 'new-run-id' }] };
      }),
    };

    const mockSpawnFn = vi.fn().mockResolvedValue({ ok: true });
    const mockExecFn = vi.fn().mockReturnValue('');

    const task = {
      id: 'task-db-error-001',
      task_type: 'harness_initiative',
      location: 'us',
      payload: { orchestrator: 'skill-relay', executor: 'claude' },
    };

    // DB 失败 → 不应因 active_run_guard 拒绝（fail-open）
    const result = await spawnSkillRelaySession(task, {
      pool: mockPool,
      spawnFn: mockSpawnFn,
      execFn: mockExecFn,
      loadSkill: () => 'skill content',
      ensureWt: async () => '/tmp/wt',
      tokenFn: async () => 'gh-token',
    });

    // fail-open：不应因 DB 报错而拒绝
    expect(result.reason).not.toBe('active_run_guard');
  });
});

// ─── TC-REG：注册序列 queued + blocked → 仅 queued 被选中 ────────────────────
describe('TC-REG: 注册序列回归 — blocked 任务不进 queued 池', () => {
  it('TC-REG-1: status=blocked 注册时，INSERT 参数不得包含 "queued"（状态不被篡改）', async () => {
    const capturedStatuses = [];

    queryMock.mockReset();
    // 每次 POST 都先 dedup 空，再 INSERT
    queryMock.mockImplementation(async (sql, params) => {
      if (/INSERT INTO tasks/i.test(sql)) {
        capturedStatuses.push(params[4]); // $5 = status
        return makeInsertResult(params[4]);
      }
      return { rows: [] }; // dedup / 其他
    });

    const app = makeApp();

    // 注册序列：task1=queued, task2=blocked, task3=blocked
    await request(app).post('/api/brain/tasks').send({ title: 'task1 queued' });
    await request(app).post('/api/brain/tasks').send({ title: 'task2 blocked', status: 'blocked' });
    await request(app).post('/api/brain/tasks').send({ title: 'task3 blocked', status: 'blocked' });

    // 断言：capturedStatuses = ['queued', 'blocked', 'blocked']
    // ← 当前代码 FAIL：task2/task3 的 status 被强制改成 'queued'
    expect(capturedStatuses[0]).toBe('queued');
    expect(capturedStatuses[1]).toBe('blocked'); // ← 当前代码 FAIL
    expect(capturedStatuses[2]).toBe('blocked'); // ← 当前代码 FAIL
  });
});
