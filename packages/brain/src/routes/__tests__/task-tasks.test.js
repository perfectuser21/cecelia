/**
 * task-tasks.test.js (routes/__tests__) — lint-test-pairing 配套
 *
 * B51: harness_initiative 任务创建缺 journey_id 时返回 warnings 字段。
 * journey_id 顶层字段合并进 payload（Line 指挥页全景图关联）。
 * 去重护栏：POST / 在 INSERT 前查重，命中 queued/in_progress 则返回 200 + deduplicated:true。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../domain-detector.js', () => ({ detectDomain: () => ({ domain: 'agent_ops' }) }));

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

// 空的去重查询结果（无重复）
const NO_DUP = { rows: [] };

describe('task-tasks routes — 服务端去重护栏', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('title+status 命中 queued 任务 → 200 + deduplicated:true，不插入', async () => {
    const existing = { id: 'dup-1', title: 'Dup Task', status: 'queued', task_type: 'dev', priority: 'P2', created_at: '2026-01-01T00:00:00Z' };
    mockPool.query.mockResolvedValueOnce({ rows: [existing] }); // dedup hit
    const res = await request(app).post('/tasks').send({ title: 'Dup Task' });
    expect(res.status).toBe(200);
    expect(res.body.deduplicated).toBe(true);
    expect(res.body.id).toBe('dup-1');
    // INSERT 不应被调用（只有一次 query = dedup check）
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('title 命中 in_progress 任务 → 200 + deduplicated:true', async () => {
    const existing = { id: 'dup-2', title: 'Running Task', status: 'in_progress', task_type: 'dev', priority: 'P1', created_at: '2026-01-01T00:00:00Z' };
    mockPool.query.mockResolvedValueOnce({ rows: [existing] });
    const res = await request(app).post('/tasks').send({ title: 'Running Task' });
    expect(res.status).toBe(200);
    expect(res.body.deduplicated).toBe(true);
    expect(res.body.status).toBe('in_progress');
  });

  it('无重复任务 → 正常 INSERT，返回 201', async () => {
    mockPool.query
      .mockResolvedValueOnce(NO_DUP) // dedup check
      .mockResolvedValueOnce({ rows: [{ id: 'new-1', title: 'Fresh Task', status: 'queued', task_type: 'dev' }] }); // INSERT
    const res = await request(app).post('/tasks').send({ title: 'Fresh Task' });
    expect(res.status).toBe(201);
    expect(res.body.deduplicated).toBeUndefined();
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('去重查询使用正确的参数（title + goal_id + project_id）', async () => {
    mockPool.query
      .mockResolvedValueOnce(NO_DUP)
      .mockResolvedValueOnce({ rows: [{ id: 'new-2', title: 'Task', status: 'queued', task_type: 'dev' }] });
    await request(app).post('/tasks').send({ title: 'Task', goal_id: 'g-1', project_id: 'p-1' });
    const [dedupSql, dedupParams] = mockPool.query.mock.calls[0];
    expect(dedupSql).toMatch(/status IN.*queued.*in_progress/);
    expect(dedupParams[0]).toBe('Task');
    expect(dedupParams[1]).toBe('g-1');
    expect(dedupParams[2]).toBe('p-1');
  });
});

describe('task-tasks routes — B51 journey_id warning', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('harness_initiative 缺 journey_id → 201 + warnings', async () => {
    mockPool.query
      .mockResolvedValueOnce(NO_DUP)
      .mockResolvedValueOnce({ rows: [{ id: 'hi-1', title: 'Init', status: 'queued', task_type: 'harness_initiative' }] });
    const res = await request(app).post('/tasks').send({
      title: 'Init',
      task_type: 'harness_initiative',
      payload: { sprint_dir: 'sprints/t' },
    });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings[0]).toMatch(/journey_id/);
  });

  it('harness_initiative 含 journey_id → 201 无 warnings', async () => {
    mockPool.query
      .mockResolvedValueOnce(NO_DUP)
      .mockResolvedValueOnce({ rows: [{ id: 'hi-2', title: 'Init', status: 'queued', task_type: 'harness_initiative' }] });
    const res = await request(app).post('/tasks').send({
      title: 'Init',
      task_type: 'harness_initiative',
      payload: { sprint_dir: 'sprints/t', journey_id: 'j-1' },
    });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeUndefined();
  });

  it('非 harness_initiative 缺 journey_id → 无 warnings', async () => {
    mockPool.query
      .mockResolvedValueOnce(NO_DUP)
      .mockResolvedValueOnce({ rows: [{ id: 'dev-1', title: 'Dev Task', status: 'queued', task_type: 'dev' }] });
    const res = await request(app).post('/tasks').send({ title: 'Dev Task' });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeUndefined();
  });
});

describe('task-tasks routes — 顶层 journey_id 合并进 payload', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('顶层 journey_id → payload.journey_id 写入 INSERT', async () => {
    mockPool.query
      .mockResolvedValueOnce(NO_DUP)
      .mockResolvedValueOnce({ rows: [{ id: 'dev-j1', title: 'Task with journey', status: 'queued', task_type: 'dev' }] });
    const res = await request(app).post('/tasks').send({
      title: 'Task with journey',
      journey_id: 'j-line01',
    });
    expect(res.status).toBe(201);
    // INSERT 是第二次 query call（index 1）
    const [sql, params] = mockPool.query.mock.calls[1];
    expect(sql).toMatch(/payload/);
    const payloadArg = params.find(p => typeof p === 'string' && p.includes('journey_id'));
    expect(payloadArg).toBeTruthy();
    expect(JSON.parse(payloadArg)).toMatchObject({ journey_id: 'j-line01' });
  });

  it('顶层 journey_id 与已有 payload 合并（不覆盖其他字段）', async () => {
    mockPool.query
      .mockResolvedValueOnce(NO_DUP)
      .mockResolvedValueOnce({ rows: [{ id: 'dev-j2', title: 'Task', status: 'queued', task_type: 'harness_initiative' }] });
    const res = await request(app).post('/tasks').send({
      title: 'Task',
      task_type: 'harness_initiative',
      journey_id: 'j-line04',
      payload: { sprint_dir: 'sprints/abc' },
    });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeUndefined();
    const [, params] = mockPool.query.mock.calls[1];
    const payloadArg = params.find(p => typeof p === 'string' && p.includes('journey_id'));
    const parsed = JSON.parse(payloadArg);
    expect(parsed).toMatchObject({ journey_id: 'j-line04', sprint_dir: 'sprints/abc' });
  });

  it('payload 已含 journey_id 且顶层无传 → 不被清除', async () => {
    mockPool.query
      .mockResolvedValueOnce(NO_DUP)
      .mockResolvedValueOnce({ rows: [{ id: 'dev-j3', title: 'Task', status: 'queued', task_type: 'dev' }] });
    const res = await request(app).post('/tasks').send({
      title: 'Task',
      payload: { journey_id: 'j-already', extra: 'data' },
    });
    expect(res.status).toBe(201);
    const [, params] = mockPool.query.mock.calls[1];
    const payloadArg = params.find(p => typeof p === 'string' && p.includes('journey_id'));
    expect(JSON.parse(payloadArg)).toMatchObject({ journey_id: 'j-already', extra: 'data' });
  });
});

describe('task-tasks routes — ability_id 十字边', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('创建任务时 ability_id 透传到 INSERT 参数并回显', async () => {
    mockPool.query
      .mockResolvedValueOnce(NO_DUP)
      .mockResolvedValueOnce({ rows: [{ id: 'dev-9', title: 'Build douyin publish', status: 'queued', task_type: 'dev', ability_id: 'ab-1' }] });
    const res = await request(app).post('/tasks').send({
      title: 'Build douyin publish',
      ability_id: 'ab-1',
    });
    expect(res.status).toBe(201);
    // INSERT 是第二次 query call（index 1）
    const params = mockPool.query.mock.calls[1][1];
    expect(params).toContain('ab-1');
    expect(mockPool.query.mock.calls[1][0]).toMatch(/ability_id/);
    expect(res.body.ability_id).toBe('ab-1');
  });

  it('不传 ability_id 时为 null，不报错', async () => {
    mockPool.query
      .mockResolvedValueOnce(NO_DUP)
      .mockResolvedValueOnce({ rows: [{ id: 'dev-10', title: 'Plain task', status: 'queued', task_type: 'dev', ability_id: null }] });
    const res = await request(app).post('/tasks').send({ title: 'Plain task' });
    expect(res.status).toBe(201);
    const params = mockPool.query.mock.calls[1][1];
    expect(params[params.length - 1]).toBeNull();
  });
});
