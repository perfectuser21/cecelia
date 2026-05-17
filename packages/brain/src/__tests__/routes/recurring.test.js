import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/recurring.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/recurring-tasks', router);
  return app;
}

describe('recurring routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ── GET / ────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns all recurring tasks', async () => {
      const rows = [
        { id: 'r1', title: 'Daily report', is_active: true, executor: 'cecelia' },
        { id: 'r2', title: 'Weekly sync', is_active: false, executor: 'cecelia' },
      ];
      mockPool.query.mockResolvedValueOnce({ rows });

      const res = await request(app).get('/recurring-tasks');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].id).toBe('r1');
    });

    it('returns empty array when no tasks', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/recurring-tasks');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('queries recurring_tasks ordered by created_at DESC', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/recurring-tasks');
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('recurring_tasks');
      expect(sql).toContain('created_at DESC');
    });

    it('returns 500 on DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('connection lost'));
      const res = await request(app).get('/recurring-tasks');
      expect(res.status).toBe(500);
      expect(res.body.error).toBeTruthy();
    });
  });

  // ── POST / ───────────────────────────────────────────────────────────────

  describe('POST /', () => {
    it('creates task with title only → 201', async () => {
      const row = { id: 'new-1', title: 'New task', executor: 'cecelia', is_active: true };
      mockPool.query.mockResolvedValueOnce({ rows: [row] });

      const res = await request(app).post('/recurring-tasks').send({ title: 'New task' });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New task');
    });

    it('returns 400 when title missing', async () => {
      const res = await request(app).post('/recurring-tasks').send({ description: 'No title' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('title');
    });

    it('uses default executor=cecelia when not provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'x' }] });
      await request(app).post('/recurring-tasks').send({ title: 'T' });
      const [, params] = mockPool.query.mock.calls[0];
      expect(params[3]).toBe('cecelia');
    });

    it('uses default is_active=true', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'x' }] });
      await request(app).post('/recurring-tasks').send({ title: 'T' });
      const [, params] = mockPool.query.mock.calls[0];
      expect(params[4]).toBe(true);
    });

    it('passes optional fields: cron_expression, goal_id, project_id', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'x' }] });
      await request(app).post('/recurring-tasks').send({
        title: 'T', cron_expression: '0 9 * * *', goal_id: 'g1', project_id: 'p1', priority: 'P2',
      });
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO recurring_tasks');
      expect(params[2]).toBe('0 9 * * *');
      expect(params[6]).toBe('P2');
      expect(params[7]).toBe('g1');
      expect(params[8]).toBe('p1');
    });

    it('sets goal_id to null when not provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'x' }] });
      await request(app).post('/recurring-tasks').send({ title: 'T' });
      const [, params] = mockPool.query.mock.calls[0];
      expect(params[7]).toBeNull();
    });

    it('returns 500 on DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('insert fail'));
      const res = await request(app).post('/recurring-tasks').send({ title: 'T' });
      expect(res.status).toBe(500);
    });
  });

  // ── PATCH /:id ───────────────────────────────────────────────────────────

  describe('PATCH /:id', () => {
    it('updates a single allowed field', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'r1', is_active: false }] });
      const res = await request(app).patch('/recurring-tasks/r1').send({ is_active: false });
      expect(res.status).toBe(200);
      expect(res.body.is_active).toBe(false);
    });

    it('updates multiple fields', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
      await request(app).patch('/recurring-tasks/r1').send({ title: 'New', priority: 'P2', is_active: true });
      const [sql, values] = mockPool.query.mock.calls[0];
      expect(sql).toContain('title = $1');
      expect(sql).toContain('is_active = $2');
      expect(sql).toContain('priority = $3');
      expect(values[0]).toBe('New');
    });

    it('ignores unknown/non-allowed fields', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
      await request(app).patch('/recurring-tasks/r1').send({ title: 'T', hacked_field: 'x' });
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).not.toContain('hacked_field');
    });

    it('returns 400 when no allowed fields provided', async () => {
      const res = await request(app).patch('/recurring-tasks/r1').send({ unknown_field: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });

    it('returns 404 when task not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).patch('/recurring-tasks/missing').send({ title: 'T' });
      expect(res.status).toBe(404);
    });

    it('returns 500 on DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('update fail'));
      const res = await request(app).patch('/recurring-tasks/r1').send({ title: 'T' });
      expect(res.status).toBe(500);
    });
  });

  // ── DELETE /:id ──────────────────────────────────────────────────────────

  describe('DELETE /:id', () => {
    it('deletes task and returns deleted info', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'r1', title: 'Old task' }] });
      const res = await request(app).delete('/recurring-tasks/r1');
      expect(res.status).toBe(200);
      expect(res.body.deleted.id).toBe('r1');
      expect(res.body.deleted.title).toBe('Old task');
    });

    it('returns 404 when task not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).delete('/recurring-tasks/missing');
      expect(res.status).toBe(404);
    });

    it('passes correct id to DELETE query', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'r1', title: 'T' }] });
      await request(app).delete('/recurring-tasks/r1');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('DELETE FROM recurring_tasks');
      expect(params[0]).toBe('r1');
    });

    it('returns 500 on DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('delete fail'));
      const res = await request(app).delete('/recurring-tasks/r1');
      expect(res.status).toBe(500);
    });
  });
});
