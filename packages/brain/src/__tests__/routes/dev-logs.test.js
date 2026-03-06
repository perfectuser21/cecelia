/**
 * Route tests: /api/brain/dev-logs
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = {
  query: vi.fn(),
};
vi.mock('../../db.js', () => ({ default: mockPool }));

const { default: router } = await import('../../routes/dev-logs.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/dev-logs', router);
  return app;
}

describe('dev-logs routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('POST /dev-logs', () => {
    it('returns 400 if required fields missing', async () => {
      const res = await request(app).post('/dev-logs').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required/);
    });

    it('creates a log entry with valid data', async () => {
      const logEntry = {
        task_id: 'task-1',
        run_id: 'run-1',
        phase: 'code',
        status: 'success',
      };
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: '1', ...logEntry }],
      });

      const res = await request(app).post('/dev-logs').send(logEntry);
      expect(res.status).toBe(201);
      expect(res.body.task_id).toBe('task-1');
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('returns 500 on DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB down'));
      const res = await request(app).post('/dev-logs').send({
        task_id: 't', run_id: 'r', phase: 'p', status: 's',
      });
      expect(res.status).toBe(500);
    });
  });

  describe('GET /dev-logs/stats', () => {
    it('returns stats with overall, by_phase, trend_7d', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ success_count: '5', failure_count: '2', total_count: '7', success_rate: '71.43' }] })
        .mockResolvedValueOnce({ rows: [{ phase: 'code', failure_count: '2', total_count: '5', failure_rate: '40.00' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/dev-logs/stats');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('overall');
      expect(res.body).toHaveProperty('by_phase');
      expect(res.body).toHaveProperty('trend_7d');
    });
  });

  describe('GET /dev-logs/:task_id', () => {
    it('returns logs for a task', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: '1', task_id: 'task-1', phase: 'code', status: 'success' }],
      });

      const res = await request(app).get('/dev-logs/task-1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].task_id).toBe('task-1');
    });

    it('respects limit and offset query params', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/dev-logs/task-1?limit=10&offset=5');
      const callArgs = mockPool.query.mock.calls[0];
      expect(callArgs[1]).toContain(10);
      expect(callArgs[1]).toContain(5);
    });
  });
});
