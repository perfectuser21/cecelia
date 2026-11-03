// 此执行器测试注入模拟传输；真实隔离入口由 runtime-isolation.test.js 验证。
vi.mock('../runtime-safety.js', () => ({ assertExternalExecutionAllowed: () => {} }));
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

// ─── 公共 mock（TC-A/TC-B/TC-REG 共用）──────────────────────────────────────
const queryMock = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => queryMock(...a) } }));
const routedTaskMock = vi.hoisted(() => vi.fn());
vi.mock('../work-routing-store.js', () => ({ createRoutedTask: routedTaskMock }));

// TC-B 需要的额外 mock（selectNextDispatchableTask 依赖）
vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false }),
}));
vi.mock('../task-weight.js', () => ({
  sortTasksByWeight: vi.fn((rows) => rows),
}));
vi.mock('../actions.js', () => ({
  updateTask: vi.fn().mockResolvedValue({}),
  createTask: vi.fn().mockResolvedValue({}),
}));
vi.mock('../slot-allocator.js', () => ({
  shouldBypassBackpressure: vi.fn().mockReturnValue(true),
}));

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
    routedTaskMock.mockReset();
    routedTaskMock.mockImplementation(async (_db, input) => ({
      task: makeInsertResult(input.task.status, input.task.blocked_at).rows[0],
    }));
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
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // dedup
      .mockImplementation(async (sql, params) => {
        if (/INSERT INTO tasks/i.test(sql)) {
          return makeInsertResult('blocked', new Date().toISOString());
        }
        return { rows: [] };
      });

    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '被阻断任务', task_type: 'research', status: 'blocked' });

    // 断言：HTTP 成功（201）
    expect(res.status).toBe(201);

    // 断言：INSERT params 中 status 位置（$5）应为 'blocked'，不能被改成 'queued'
    // params 顺序：title, description, priority, task_type, status, project_id, ...
    expect(routedTaskMock.mock.calls[0][1].task.status).toBe('blocked');
  });

  it('TC-A-2: 携带 status=blocked 时，INSERT SQL 必须含 blocked_at 字段', async () => {
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // dedup
      .mockImplementation(async (sql, params) => {
        if (/INSERT INTO tasks/i.test(sql)) {
          return makeInsertResult('blocked', new Date().toISOString());
        }
        return { rows: [] };
      });

    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '被阻断任务B', task_type: 'research', status: 'blocked' });

    expect(res.status).toBe(201);

    // 断言：INSERT SQL 中含 blocked_at 列
    expect(routedTaskMock.mock.calls[0][1].task.blocked_at).toBeTruthy();
  });

  it('TC-A-3: status=queued 正常注册（回归保护，不得破坏）', async () => {
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // dedup
      .mockResolvedValueOnce(makeInsertResult('queued'));

    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '普通任务', task_type: 'research' });

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
      .send({ title: '部署后任务', task_type: 'research', status: 'pending_postdeploy' });

    expect(res.status).toBe(201);
  });
});

// 退役入口在查询旧run之前拒绝；既有在途run保持原状，不再建第二个会话。
describe('TC-C: 旧relay退役防重新启动',()=>{
 it.each(['claude','codex','existing_run','db_unavailable'])('无论旧执行状态%s均拒绝，零DB/worktree/session副作用',async state=>{
  const effect=vi.fn(()=>{throw Error('must not execute');});
  const result=await spawnSkillRelaySession({id:'historical',task_type:'harness_initiative',payload:{orchestrator:'skill-relay',executor:state==='claude'?'claude':'codex'}},{pool:{query:effect},spawnFn:effect,execFn:effect,ensureWt:effect,loadSkill:effect,tokenFn:effect});
  expect(result).toMatchObject({ok:false,error:'kernel_runtime_retired'});expect(effect).not.toHaveBeenCalled();
 });
});

// ─── TC-B：dispatcher selectNextDispatchableTask WHERE 仅选 queued ────────────
describe('TC-B: dispatcher 遇 blocked 任务 → selectNextDispatchableTask 不选', () => {
  it('TC-B-1: SELECT SQL WHERE 子句仅选 status=queued，blocked 任务在筛选范围外', async () => {
    const { selectNextDispatchableTask } = await import('../dispatch-helpers.js');

    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] }); // 返回空集，模拟无可派发任务

    await selectNextDispatchableTask(['any-goal-id']);

    // 断言：DB 被调用（dispatcher 真的查了 DB）
    expect(queryMock).toHaveBeenCalled();
    // 找到包含 SELECT FROM tasks 的主查询
    const mainSqlCall = queryMock.mock.calls.find(c => /SELECT.*FROM tasks/i.test(c[0]));
    expect(mainSqlCall).toBeDefined();
    const sql = mainSqlCall[0];
    // 断言：WHERE 子句仅选 status='queued'，不含 'blocked'
    expect(sql).toContain("t.status = 'queued'");
    expect(sql).not.toMatch(/status\s*=\s*'blocked'/);
  });
});

// ─── TC-REG：注册序列 queued + blocked → 仅 queued 被选中 ────────────────────
describe('TC-REG: 注册序列回归 — blocked 任务不进 queued 池', () => {
  it('TC-REG-1: status=blocked 注册时，INSERT 参数不得包含 "queued"（状态不被篡改）', async () => {
    queryMock.mockReset();
    routedTaskMock.mockClear();
    // 每次 POST 都先 dedup 空，再 INSERT
    queryMock.mockImplementation(async (sql, params) => {
      if (/INSERT INTO tasks/i.test(sql)) {
        return makeInsertResult(params[4]);
      }
      return { rows: [] }; // dedup / 其他
    });

    const app = makeApp();

    // 注册序列：task1=queued, task2=blocked, task3=blocked
    await request(app).post('/api/brain/tasks').send({ title: 'task1 queued', task_type: 'research' });
    await request(app).post('/api/brain/tasks').send({ title: 'task2 blocked', task_type: 'research', status: 'blocked' });
    await request(app).post('/api/brain/tasks').send({ title: 'task3 blocked', task_type: 'research', status: 'blocked' });

    // 断言：capturedStatuses = ['queued', 'blocked', 'blocked']
    // ← 当前代码 FAIL：task2/task3 的 status 被强制改成 'queued'
    const capturedStatuses = routedTaskMock.mock.calls.map((call) => call[1].task.status);
    expect(capturedStatuses[0]).toBe('queued');
    expect(capturedStatuses[1]).toBe('blocked');
    expect(capturedStatuses[2]).toBe('blocked');
  });
});
