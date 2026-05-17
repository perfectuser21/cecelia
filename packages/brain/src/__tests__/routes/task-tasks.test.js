/**
 * Route tests: /api/brain/tasks (task-tasks.js)
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

// isolate:false 修复：不在顶层 await import，改为 beforeAll + vi.resetModules()
let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/task-tasks.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/tasks', router);
  return app;
}

describe('task-tasks routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('GET /tasks', () => {
    it('lists tasks with default limit/offset', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 't1', title: 'Task 1', status: 'queued' }],
      });

      const res = await request(app).get('/tasks');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      // Default limit=200, offset=0
      const params = mockPool.query.mock.calls[0][1];
      expect(params).toContain(200);
      expect(params).toContain(0);
    });

    it('filters by status and project_id', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/tasks?status=queued&project_id=proj-1');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('status = $1');
      expect(sql).toContain('project_id = $2');
      expect(params[0]).toBe('queued');
      expect(params[1]).toBe('proj-1');
    });

    it('respects custom limit and offset', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/tasks?limit=10&offset=30');
      const params = mockPool.query.mock.calls[0][1];
      expect(params).toContain(10);
      expect(params).toContain(30);
    });
  });

  describe('GET /tasks/:id', () => {
    it('returns 404 for non-existent task', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/tasks/non-existent');
      expect(res.status).toBe(404);
    });

    it('returns task by id', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 't1', title: 'Task 1' }],
      });
      const res = await request(app).get('/tasks/t1');
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Task 1');
    });
  });

  describe('POST /tasks', () => {
    it('creates task with title only → 201', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'new-uuid',
          title: 'New Task',
          status: 'queued',
          task_type: 'dev',
          priority: 'P2',
          project_id: null,
          created_at: '2026-03-06T00:00:00Z',
        }],
      });

      const res = await request(app).post('/tasks').send({ title: 'New Task' });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New Task');
      expect(res.body.status).toBe('queued');
    });

    it('returns 400 when title is missing', async () => {
      const res = await request(app).post('/tasks').send({ task_type: 'dev' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/title/);
    });

    it('returns 400 when title is empty string', async () => {
      const res = await request(app).post('/tasks').send({ title: '' });
      expect(res.status).toBe(400);
    });

    it('passes all optional fields to INSERT', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'arch-uuid',
          title: 'Architecture Task',
          status: 'queued',
          task_type: 'architecture_design',
          priority: 'P1',
          project_id: 'proj-123',
          created_at: '2026-03-06T00:00:00Z',
        }],
      });

      const res = await request(app).post('/tasks').send({
        title: 'Architecture Task',
        description: 'Design the new flow',
        priority: 'P1',
        task_type: 'architecture_design',
        project_id: 'proj-123',
        trigger_source: 'architect',
        metadata: { architecture_ref: 'architecture.md' },
      });

      expect(res.status).toBe(201);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO tasks');
      expect(params).toContain('Architecture Task');
      expect(params).toContain('architecture_design');
      expect(params).toContain('P1');
      expect(params).toContain('architect');
      expect(params).toContain('proj-123');
    });

    // ── 回归测试：Bug1/Bug2/Bug3 修复验证 ──

    it('[Bug1] 传 payload 字段 → INSERT params 包含 payload JSON', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'x', title: 'T', status: 'queued', task_type: 'dev', priority: 'P2', project_id: null, created_at: '' }],
      });

      await request(app).post('/tasks').send({
        title: 'T',
        payload: { depends_on: ['task-a', 'task-b'], architecture_ref: 'arch.md' },
      });

      const [, params] = mockPool.query.mock.calls[0];
      const payloadParam = params.find(p => typeof p === 'string' && p.includes('depends_on'));
      expect(payloadParam).toBeDefined();
      expect(JSON.parse(payloadParam)).toEqual({ depends_on: ['task-a', 'task-b'], architecture_ref: 'arch.md' });
    });

    it('[Bug2] 不传 location → INSERT params 第8个参数为 "us"（不是 null）', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'x', title: 'T', status: 'queued', task_type: 'dev', priority: 'P2', project_id: null, created_at: '' }],
      });

      await request(app).post('/tasks').send({ title: 'T' });

      // params 顺序：title, description, priority, task_type, project_id, area_id, goal_id, location, payload, trigger_source
      const [, params] = mockPool.query.mock.calls[0];
      expect(params[7]).toBe('us'); // location 在第8个位置（index 7）
    });

    it('[Bug3] 不传 trigger_source → INSERT params 包含 "auto"（不是 "api"）', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'x', title: 'T', status: 'queued', task_type: 'dev', priority: 'P2', project_id: null, created_at: '' }],
      });

      await request(app).post('/tasks').send({ title: 'T' });

      const [, params] = mockPool.query.mock.calls[0];
      expect(params).toContain('auto');
      expect(params).not.toContain('api');
    });

    it('returns 400 for DB check constraint violation (23514)', async () => {
      const err = new Error('check constraint violated');
      err.code = '23514';
      mockPool.query.mockRejectedValueOnce(err);

      const res = await request(app).post('/tasks').send({ title: 'Bad', task_type: 'invalid_type' });
      expect(res.status).toBe(400);
    });

    it('returns 500 on generic DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('connection reset'));

      const res = await request(app).post('/tasks').send({ title: 'Task' });
      expect(res.status).toBe(500);
    });

    it('passes okr_initiative_id to INSERT when provided', async () => {
      const initId = 'c0362394-ba7c-44c7-9386-e7947f604237';
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'new-uuid', title: 'T', status: 'queued', task_type: 'dev',
          priority: 'P2', project_id: null, goal_id: null,
          okr_initiative_id: initId, created_at: '' }],
      });

      const res = await request(app).post('/tasks').send({
        title: 'T',
        okr_initiative_id: initId,
      });

      expect(res.status).toBe(201);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('okr_initiative_id');
      expect(params).toContain(initId);
    });

    it('passes null okr_initiative_id when not provided', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'x', title: 'T', status: 'queued', task_type: 'dev',
          priority: 'P2', project_id: null, okr_initiative_id: null, created_at: '' }],
      });

      await request(app).post('/tasks').send({ title: 'T' });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('okr_initiative_id');
      // last param should be null (okr_initiative_id default)
      expect(params[params.length - 1]).toBeNull();
    });
  });

  describe('PATCH /tasks/:id', () => {
    it('returns 400 when no fields provided', async () => {
      const res = await request(app).patch('/tasks/t1').send({});
      expect(res.status).toBe(400);
    });

    it('updates status and priority', async () => {
      // 状态机保护：PATCH handler 先 SELECT 当前状态，再 UPDATE
      mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'queued' }] }); // SELECT current status
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 't1', status: 'completed', priority: 'P0' }],
      }); // UPDATE RETURNING *

      const res = await request(app).patch('/tasks/t1').send({ status: 'completed', priority: 'P0' });
      expect(res.status).toBe(200);
      // mock.calls[1] 是 UPDATE（calls[0] 是 SELECT current status）
      const [sql] = mockPool.query.mock.calls[1];
      expect(sql).toContain('status = $1');
      expect(sql).toContain('priority = $2');
    });

    it('returns 404 when task not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).patch('/tasks/missing').send({ title: 'x' });
      expect(res.status).toBe(404);
    });

    it('updates okr_initiative_id when provided', async () => {
      const initId = 'c0362394-ba7c-44c7-9386-e7947f604237';
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 't1', status: 'queued', okr_initiative_id: initId }],
      });

      const res = await request(app).patch('/tasks/t1').send({ okr_initiative_id: initId });
      expect(res.status).toBe(200);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('okr_initiative_id = $1');
      expect(params).toContain(initId);
    });

    it('sets okr_initiative_id to null when explicitly passed null', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 't1', status: 'queued', okr_initiative_id: null }],
      });

      const res = await request(app).patch('/tasks/t1').send({ okr_initiative_id: null });
      expect(res.status).toBe(200);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('okr_initiative_id');
      expect(params).toContain(null);
    });
  });
});
