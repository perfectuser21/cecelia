/**
 * task-tasks.test.js (routes/__tests__) — lint-test-pairing 配套
 *
 * B51: harness_initiative 任务创建缺 journey_id 时返回 warnings 字段。
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

describe('task-tasks routes — B51 journey_id warning', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('harness_initiative 缺 journey_id → 201 + warnings', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'hi-1', title: 'Init', status: 'queued', task_type: 'harness_initiative' }],
    });
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
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'hi-2', title: 'Init', status: 'queued', task_type: 'harness_initiative' }],
    });
    const res = await request(app).post('/tasks').send({
      title: 'Init',
      task_type: 'harness_initiative',
      payload: { sprint_dir: 'sprints/t', journey_id: 'j-1' },
    });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeUndefined();
  });

  it('非 harness_initiative 缺 journey_id → 无 warnings', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-1', title: 'Dev Task', status: 'queued', task_type: 'dev' }],
    });
    const res = await request(app).post('/tasks').send({ title: 'Dev Task' });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeUndefined();
  });
});

describe('task-tasks routes — ability_id 十字边', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('创建任务时 ability_id 透传到 INSERT 参数并回显', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-9', title: 'Build douyin publish', status: 'queued', task_type: 'dev', ability_id: 'ab-1' }],
    });
    const res = await request(app).post('/tasks').send({
      title: 'Build douyin publish',
      ability_id: 'ab-1',
    });
    expect(res.status).toBe(201);
    // INSERT 参数数组最后一位是 ability_id
    const params = mockPool.query.mock.calls[0][1];
    expect(params).toContain('ab-1');
    // SQL 文本含 ability_id 列
    expect(mockPool.query.mock.calls[0][0]).toMatch(/ability_id/);
    expect(res.body.ability_id).toBe('ab-1');
  });

  it('不传 ability_id 时为 null，不报错', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-10', title: 'Plain task', status: 'queued', task_type: 'dev', ability_id: null }],
    });
    const res = await request(app).post('/tasks').send({ title: 'Plain task' });
    expect(res.status).toBe(201);
    const params = mockPool.query.mock.calls[0][1];
    expect(params[params.length - 1]).toBeNull();
  });
});
