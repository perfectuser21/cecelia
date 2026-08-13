/**
 * task-tasks.test.js (routes/__tests__) — lint-test-pairing 配套
 *
 * B51: harness_initiative 任务创建缺 journey_id 时返回 warnings 字段。
 * journey_id 顶层字段合并进 payload（Line 指挥页全景图关联）。
 * C3: POST /tasks 服务端去重护栏（issue 655691d2）——title+goal_id/project_id 精确匹配
 * + status IN (queued,in_progress) 命中则返回已有任务不新建。
 *
 * 注意：加了去重查询后，每个成功请求会先跑一次 SELECT（去重检查）再跑 INSERT，
 * 所以下面所有已有测试的 mock 调用顺序都要先给一次「无命中」的空结果
 * （mockResolvedValueOnce({ rows: [] })），INSERT 相关的 mock.calls 下标也从
 * [0] 移到 [1]。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
const mockCreateRoutedTask = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../domain-detector.js', () => ({ detectDomain: () => ({ domain: 'agent_ops' }) }));
vi.mock('../../work-routing-store.js', () => ({ createRoutedTask: mockCreateRoutedTask }));

let router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../task-tasks.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/tasks', router);
  return app;
}

function coding(body = {}) {
  return {
    mutation_intent: 'write',
    change_kind: 'capability_change',
    repo_hint: 'perfectuser21/cecelia',
    ...body,
  };
}

function resetRouteMocks() {
  mockPool.query.mockReset();
  mockCreateRoutedTask.mockReset();
  mockCreateRoutedTask.mockImplementation(async (_pool, request) => ({
    task_id: 'routed-task',
    routing_receipt_id: 'routed-receipt',
    task: {
      id: 'routed-task',
      title: request.title,
      status: request.task?.status ?? 'queued',
      task_type: request.mutation_intent === 'read_only' ? 'code_review' : 'harness_initiative',
      priority: request.task?.priority ?? 'P2',
      ability_id: request.task?.ability_id ?? null,
      payload: request.metadata,
    },
  }));
}

describe('task-tasks routes — tenant scope at ingress', () => {
  let app;
  beforeEach(() => {
    resetRouteMocks();
    app = createApp();
  });

  it('x-tenant-id 由服务端写入 payload，忽略 body 内伪造 tenant', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'tenant-task', title: 'Tenant task', status: 'queued' }],
    });

    const res = await request(app)
      .post('/tasks')
      .set('x-tenant-id', 'tenant-a')
      .send(coding({ title: 'Tenant task', payload: { tenant_id: 'spoofed', sprint_dir: 'sprints/t' } }));

    expect(res.status).toBe(201);
    expect(mockCreateRoutedTask.mock.calls[0][1].metadata).toMatchObject({
      tenant_id: 'tenant-a',
      sprint_dir: 'sprints/t',
    });
  });

  it('legacy caller 未带 tenant header 时归入 default tenant', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'default-task', title: 'Default task', status: 'queued' }],
    });

    const res = await request(app).post('/tasks').send(coding({ title: 'Default task' }));

    expect(res.status).toBe(201);
    expect(mockCreateRoutedTask.mock.calls[0][1].metadata).toMatchObject({
      tenant_id: 'default',
    });
  });
});

describe('task-tasks routes — PATCH 参数对齐', () => {
  let app;
  beforeEach(() => {
    resetRouteMocks();
    app = createApp();
  });

  it('只更新 priority 时参数必须是 priority + task id，不能产生幽灵占位参数', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'task-priority', priority: 'P0' }] });

    const res = await request(app).patch('/tasks/task-priority').send({ priority: 'P0' });

    expect(res.status).toBe(200);
    expect(mockPool.query.mock.calls[0][1]).toEqual(['P0', 'task-priority']);
  });

  it('blocked task 存在 unresolved Harness gap 时拒绝直写为 queued', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{
      id: 'task-gap-blocked',
      status: 'blocked',
      task_type: 'dev',
      orchestrator: null,
      has_unresolved_harness_gaps: true,
      has_pending_hard_dependencies: true,
    }] });

    const res = await request(app)
      .patch('/tasks/task-gap-blocked')
      .send({ status: 'queued' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('harness_gap_dependencies_unresolved');
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });
});

describe('task-tasks routes — B51 journey_id warning', () => {
  let app;
  beforeEach(() => {
    resetRouteMocks();
    app = createApp();
  });

  it('harness_initiative 缺 journey_id → 201 + warnings', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'hi-1', title: 'Init', status: 'queued', task_type: 'harness_initiative' }],
    });
    const res = await request(app).post('/tasks').send(coding({
      title: 'Init',
      task_type: 'harness_initiative',
      payload: { sprint_dir: 'sprints/t' },
    }));
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings[0]).toMatch(/journey_id/);
  });

  it('harness_initiative 含 journey_id → 201 无 warnings', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'hi-2', title: 'Init', status: 'queued', task_type: 'harness_initiative' }],
    });
    const res = await request(app).post('/tasks').send(coding({
      title: 'Init',
      task_type: 'harness_initiative',
      payload: { sprint_dir: 'sprints/t', journey_id: 'j-1' },
    }));
    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeUndefined();
  });

  it('非 harness_initiative 缺 journey_id → 无 warnings', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-1', title: 'Dev Task', status: 'queued', task_type: 'dev' }],
    });
    const res = await request(app).post('/tasks').send(coding({ title: 'Dev Task' }));
    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeUndefined();
  });
});

describe('task-tasks routes — 顶层 journey_id 合并进 payload', () => {
  let app;
  beforeEach(() => {
    resetRouteMocks();
    app = createApp();
  });

  it('顶层 journey_id → payload.journey_id 写入 INSERT', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-j1', title: 'Task with journey', status: 'queued', task_type: 'dev' }],
    });
    const res = await request(app).post('/tasks').send(coding({
      title: 'Task with journey',
      journey_id: 'j-line01',
    }));
    expect(res.status).toBe(201);
    expect(mockCreateRoutedTask.mock.calls[0][1].metadata).toMatchObject({ journey_id: 'j-line01' });
  });

  it('顶层 journey_id 与已有 payload 合并（不覆盖其他字段）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-j2', title: 'Task', status: 'queued', task_type: 'harness_initiative' }],
    });
    const res = await request(app).post('/tasks').send(coding({
      title: 'Task',
      task_type: 'harness_initiative',
      journey_id: 'j-line04',
      payload: { sprint_dir: 'sprints/abc' },
    }));
    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeUndefined();
    expect(mockCreateRoutedTask.mock.calls[0][1].metadata).toMatchObject({ journey_id: 'j-line04', sprint_dir: 'sprints/abc' });
  });

  it('payload 已含 journey_id 且顶层无传 → 不被清除', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-j3', title: 'Task', status: 'queued', task_type: 'dev' }],
    });
    const res = await request(app).post('/tasks').send(coding({
      title: 'Task',
      payload: { journey_id: 'j-already', extra: 'data' },
    }));
    expect(res.status).toBe(201);
    expect(mockCreateRoutedTask.mock.calls[0][1].metadata).toMatchObject({ journey_id: 'j-already', extra: 'data' });
  });
});

describe('task-tasks routes — ability_id 十字边', () => {
  let app;
  beforeEach(() => {
    resetRouteMocks();
    app = createApp();
  });

  it('创建任务时 ability_id 透传到 INSERT 参数并回显', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-9', title: 'Build douyin publish', status: 'queued', task_type: 'dev', ability_id: 'ab-1' }],
    });
    const res = await request(app).post('/tasks').send(coding({
      title: 'Build douyin publish',
      ability_id: 'ab-1',
    }));
    expect(res.status).toBe(201);
    expect(mockCreateRoutedTask.mock.calls[0][1].task.ability_id).toBe('ab-1');
    expect(res.body.ability_id).toBe('ab-1');
  });

  it('不传 ability_id 时为 null，不报错', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-10', title: 'Plain task', status: 'queued', task_type: 'dev', ability_id: null }],
    });
    const res = await request(app).post('/tasks').send(coding({ title: 'Plain task' }));
    expect(res.status).toBe(201);
    expect(mockCreateRoutedTask.mock.calls[0][1].task.ability_id).toBeNull();
  });
});

describe('task-tasks routes — C3 服务端去重护栏（issue 655691d2）', () => {
  let app;
  beforeEach(() => {
    resetRouteMocks();
    app = createApp();
  });

  it('同 title + 同 goal_id(null) + 同 project_id(null) + status=queued 已存在 → 200 + deduplicated:true，不新建', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'existing-1', title: 'nightly-real-machine-staging', status: 'queued',
        task_type: 'dev', priority: 'P1', project_id: null, area_id: null,
        goal_id: null, okr_initiative_id: null, ability_id: null, payload: null,
        created_at: '2026-07-09T00:00:00.000Z',
      }],
    });
    const res = await request(app).post('/tasks').send(coding({ title: 'nightly-real-machine-staging' }));
    expect(res.status).toBe(200);
    expect(res.body.deduplicated).toBe(true);
    expect(res.body.id).toBe('existing-1');
    // 去重命中就不应该再有第二次 query 调用（没有走 INSERT）
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('同 title 但已有任务是 completed 状态 → 不去重，正常走 INSERT', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: WHERE status IN (queued,in_progress) 查不到
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'new-1', title: 'skill-eval-4page', status: 'queued', task_type: 'dev' }],
    });
    const res = await request(app).post('/tasks').send(coding({ title: 'skill-eval-4page' }));
    expect(res.status).toBe(201);
    expect(res.body.deduplicated).toBeUndefined();
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('[REGRESSION] 历史 completed 同名任务保留终态，新任务写 recurrence_of_task_id', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'old-completed', title: '每周数据库巡检', status: 'completed', payload: {} }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'new-recurrence', title: '每周数据库巡检', status: 'queued', task_type: 'dev' }],
    });

    const res = await request(app).post('/tasks').send(coding({ title: '每周数据库巡检' }));

    expect(res.status).toBe(201);
    expect(res.body.recurrence_of_task_id).toBe('old-completed');
    expect(mockCreateRoutedTask.mock.calls[0][1].metadata).toMatchObject({
      recurrence_of_task_id: 'old-completed',
    });
  });

  it('title 不同 → 不去重，正常走 INSERT', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: title 不匹配查不到
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'new-2', title: 'decomp-check合并', status: 'queued', task_type: 'dev' }],
    });
    const res = await request(app).post('/tasks').send(coding({ title: 'decomp-check合并' }));
    expect(res.status).toBe(201);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('goal_id 不同（两者都非 null 但值不同）→ 不去重，正常走 INSERT', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: goal_id 不匹配查不到
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'new-3', title: 'Same title different goal', status: 'queued', task_type: 'dev', goal_id: 'goal-b' }],
    });
    const res = await request(app).post('/tasks').send(coding({
      title: 'Same title different goal',
      goal_id: 'goal-b',
    }));
    expect(res.status).toBe(201);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    // 去重查询的第二个参数应该是本次请求的 goal_id
    const dedupParams = mockPool.query.mock.calls[0][1];
    expect(dedupParams).toContain('goal-b');
  });

  it('title 命中 in_progress 任务 → 200 + deduplicated:true', async () => {
    const existing = { id: 'dup-2', title: 'Running Task', status: 'in_progress', task_type: 'dev', priority: 'P1', created_at: '2026-01-01T00:00:00Z' };
    mockPool.query.mockResolvedValueOnce({ rows: [existing] });
    const res = await request(app).post('/tasks').send(coding({ title: 'Running Task' }));
    expect(res.status).toBe(200);
    expect(res.body.deduplicated).toBe(true);
    expect(res.body.status).toBe('in_progress');
  });

  it('title 命中 blocked/paused 活跃任务 → 复用原任务，不制造新的 queued 副本', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'blocked-existing', title: '等待外部凭据', status: 'blocked', payload: { recurrence_requests: 2 } }],
    });

    const res = await request(app).post('/tasks').send(coding({ title: '等待外部凭据' }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'blocked-existing', status: 'blocked', deduplicated: true });
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('并发创建撞 idx_tasks_dedup_active 时读取赢家并返回 deduplicated', async () => {
    const uniqueError = Object.assign(new Error('duplicate'), {
      code: '23505', constraint: 'idx_tasks_dedup_active',
    });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'winner', title: '并发任务', status: 'queued' }] });
    mockCreateRoutedTask.mockRejectedValueOnce(uniqueError);

    const res = await request(app).post('/tasks').send(coding({ title: '并发任务' }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'winner', deduplicated: true });
  });

  it('去重查询使用正确的参数（title + goal_id + project_id）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // dedup check
      .mockResolvedValueOnce({ rows: [{ id: 'new-4', title: 'Task', status: 'queued', task_type: 'dev' }] });
    await request(app).post('/tasks').send(coding({ title: 'Task', goal_id: 'g-1', project_id: 'p-1' }));
    const [dedupSql, dedupParams] = mockPool.query.mock.calls[0];
    expect(dedupSql).toMatch(/status IN[\s\S]*queued[\s\S]*in_progress/);
    expect(dedupParams[0]).toBe('Task');
    expect(dedupParams[1]).toBe('g-1');
    expect(dedupParams[2]).toBe('p-1');
  });
});
