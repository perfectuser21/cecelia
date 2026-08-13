/**
 * Route tests: /api/brain/tasks (task-tasks.js)
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
const mockCreateRoutedTask = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../work-routing-store.js', () => ({ createRoutedTask: mockCreateRoutedTask }));

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

function coding(body = {}) {
  return { repo_hint: 'perfectuser21/cecelia', ...body };
}

describe('task-tasks routes', () => {
  let app;

  beforeEach(() => {
    mockPool.query.mockReset();
    mockCreateRoutedTask.mockReset();
    mockCreateRoutedTask.mockImplementation(async (_pool, routed) => ({
      task: {
        id: 'new-uuid',
        title: routed.title,
        status: routed.task?.status ?? 'queued',
        task_type: routed.mutation_intent === 'read_only' ? 'code_review' : 'harness_initiative',
        priority: routed.task?.priority ?? 'P2',
        project_id: routed.task?.project_id ?? null,
        okr_initiative_id: routed.task?.okr_initiative_id ?? null,
        payload: routed.metadata,
      },
    }));
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

    it('filters by journey_id（存于 payload JSONB，非顶层列）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/tasks?journey_id=journey-uuid-1');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/payload->>'journey_id' = \$1/);
      expect(params[0]).toBe('journey-uuid-1');
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
    it('rejects coding mutation without an explicit four-form change_kind', async () => {
      const res = await request(app).post('/tasks').send({
        title: 'Unclassified coding mutation',
        task_type: 'dev',
        mutation_intent: 'write',
        repo_hint: 'perfectuser21/cecelia',
      });

      expect(res.status).toBe(400);
      expect(res.body.reason_code).toBe('change_kind_required');
      expect(mockCreateRoutedTask).not.toHaveBeenCalled();
    });

    it('binds explicit routing baseline fields from the public API envelope', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const baseSha = 'a'.repeat(40);

      const res = await request(app).post('/tasks').send({
        title: 'Scoped coding mutation',
        task_type: 'dev',
        mutation_intent: 'write',
        change_kind: 'bugfix',
        repo_hint: 'perfectuser21/cecelia',
        map_scope_hint: ['capability:router'],
        branch: 'cp-router-fix',
        base_sha: baseSha,
      });

      expect(res.status).toBe(201);
      expect(mockCreateRoutedTask.mock.calls[0][1]).toMatchObject({
        declared_change_kind: 'bugfix',
        repo_hint: 'perfectuser21/cecelia',
        map_scope_hint: ['capability:router'],
        branch: 'cp-router-fix',
        base_sha: baseSha,
      });
    });

    it('creates task with title only → 201', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
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

      const res = await request(app).post('/tasks').send(coding({ title: 'New Task' }));
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
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
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
        mutation_intent: 'read_only',
      });

      expect(res.status).toBe(201);
      expect(mockCreateRoutedTask.mock.calls[0][1]).toMatchObject({
        title: 'Architecture Task',
        requested_task_type: 'architecture_design',
        mutation_intent: 'read_only',
        task: { priority: 'P1', trigger_source: 'architect', project_id: 'proj-123' },
      });
    });

    // ── 回归测试：Bug1/Bug2/Bug3 修复验证 ──

    it('[Bug1] 传 payload 字段 → INSERT params 包含 payload JSON', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'x', title: 'T', status: 'queued', task_type: 'dev', priority: 'P2', project_id: null, created_at: '' }],
      });

      await request(app).post('/tasks').send(coding({
        title: 'T',
        payload: { depends_on: ['task-a', 'task-b'], architecture_ref: 'arch.md' },
      }));

      expect(mockCreateRoutedTask.mock.calls[0][1].metadata).toEqual({
        depends_on: ['task-a', 'task-b'],
        architecture_ref: 'arch.md',
        tenant_id: 'default',
        change_kind: 'capability_change',
      });
    });

    it('[Bug2] 不传 location → INSERT params 第8个参数为 "us"（不是 null）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'x', title: 'T', status: 'queued', task_type: 'dev', priority: 'P2', project_id: null, created_at: '' }],
      });

      await request(app).post('/tasks').send(coding({ title: 'T' }));

      expect(mockCreateRoutedTask.mock.calls[0][1].task.location).toBe('us');
    });

    it('[Bug3] 不传 trigger_source → INSERT params 包含 "auto"（不是 "api"）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'x', title: 'T', status: 'queued', task_type: 'dev', priority: 'P2', project_id: null, created_at: '' }],
      });

      await request(app).post('/tasks').send(coding({ title: 'T' }));

      expect(mockCreateRoutedTask.mock.calls[0][1].task.trigger_source).toBe('auto');
    });

    it('returns 400 for DB check constraint violation (23514)', async () => {
      const err = new Error('check constraint violated');
      err.code = '23514';
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
      mockCreateRoutedTask.mockRejectedValueOnce(err);

      const res = await request(app).post('/tasks').send({ title: 'Bad', task_type: 'invalid_type', mutation_intent: 'read_only' });
      expect(res.status).toBe(400);
    });

    it('returns 500 on generic DB error', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
      mockCreateRoutedTask.mockRejectedValueOnce(new Error('connection reset'));

      const res = await request(app).post('/tasks').send(coding({ title: 'Task' }));
      expect(res.status).toBe(500);
    });

    it('passes okr_initiative_id to INSERT when provided', async () => {
      const initId = 'c0362394-ba7c-44c7-9386-e7947f604237';
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'new-uuid', title: 'T', status: 'queued', task_type: 'dev',
          priority: 'P2', project_id: null, goal_id: null,
          okr_initiative_id: initId, created_at: '' }],
      });

      const res = await request(app).post('/tasks').send(coding({
        title: 'T',
        okr_initiative_id: initId,
      }));

      expect(res.status).toBe(201);
      expect(mockCreateRoutedTask.mock.calls[0][1].task.okr_initiative_id).toBe(initId);
    });

    it('passes null okr_initiative_id when not provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'x', title: 'T', status: 'queued', task_type: 'dev',
          priority: 'P2', project_id: null, okr_initiative_id: null, created_at: '' }],
      });

      await request(app).post('/tasks').send(coding({ title: 'T' }));

      expect(mockCreateRoutedTask.mock.calls[0][1].task.okr_initiative_id).toBeNull();
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

  describe('POST /tasks — B51 harness_initiative journey_id warning', () => {
    it('harness_initiative without journey_id → 201 with warnings field', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'hi-uuid', title: 'Test Initiative', status: 'queued', task_type: 'harness_initiative' }],
      });

      const res = await request(app).post('/tasks').send(coding({
        title: 'Test Initiative',
        task_type: 'harness_initiative',
        payload: { sprint_dir: 'sprints/test' }, // 无 journey_id
      }));

      expect(res.status).toBe(201);
      expect(res.body.warnings).toBeDefined();
      expect(res.body.warnings[0]).toMatch(/journey_id/);
    });

    it('harness_initiative with journey_id → 201 without warnings', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'hi-uuid2', title: 'Test Initiative', status: 'queued', task_type: 'harness_initiative' }],
      });

      const res = await request(app).post('/tasks').send(coding({
        title: 'Test Initiative',
        task_type: 'harness_initiative',
        payload: { sprint_dir: 'sprints/test', journey_id: 'j-uuid-123' },
      }));

      expect(res.status).toBe(201);
      expect(res.body.warnings).toBeUndefined();
    });
  });
});
