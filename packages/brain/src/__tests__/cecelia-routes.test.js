/**
 * Cecelia Routes Unit Tests (mock pool — no real DB needed)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js before importing routes
vi.mock('../db.js', () => {
  const mockPool = {
    query: vi.fn(),
  };
  return { default: mockPool };
});

import pool from '../db.js';
import ceceliaRoutes from '../cecelia-routes.js';

// Helper: create mock req/res
function mockReqRes(params = {}, query = {}) {
  const req = { params, query };
  const res = {
    _data: null,
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}

// Get route handlers from the router
function getHandler(method, path) {
  const layers = ceceliaRoutes.stack.filter(
    l => l.route && l.route.methods[method] && l.route.path === path
  );
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

describe('cecelia-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /overview', () => {
    const handler = getHandler('get', '/overview');

    it('should return overview with correct status counts', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { mapped_status: 'running', cnt: 3 },
            { mapped_status: 'completed', cnt: 5 },
            { mapped_status: 'failed', cnt: 1 },
            { mapped_status: 'pending', cnt: 2 },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            title: 'Test Task',
            status: 'in_progress',
            payload: { prd_path: '/tmp/test.md', current_step: '3' },
            started_at: new Date('2026-02-05T10:00:00Z'),
            updated_at: new Date('2026-02-05T10:05:00Z'),
            completed_at: null,
          }],
        });

      const { req, res } = mockReqRes({}, { limit: '20' });
      await handler(req, res);

      expect(res._data.success).toBe(true);
      expect(res._data.total_runs).toBe(11);
      expect(res._data.running).toBe(3);
      expect(res._data.completed).toBe(5);
      expect(res._data.failed).toBe(1);
      expect(res._data.recent_runs).toHaveLength(1);
      expect(res._data.recent_runs[0].project).toBe('Test Task');
      expect(res._data.recent_runs[0].status).toBe('running');
      expect(res._data.recent_runs[0].completed_checkpoints).toBe(2);
      expect(res._data.recent_runs[0].current_checkpoint).toBe('分支创建');
    });

    it('should return empty overview when no tasks', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes({}, {});
      await handler(req, res);

      expect(res._data.success).toBe(true);
      expect(res._data.total_runs).toBe(0);
      expect(res._data.running).toBe(0);
      expect(res._data.recent_runs).toEqual([]);
    });

    it('should handle DB error gracefully', async () => {
      pool.query.mockRejectedValue(new Error('connection refused'));

      const { req, res } = mockReqRes({}, {});
      await handler(req, res);

      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('connection refused');
    });

    it('should respect limit parameter', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes({}, { limit: '5' });
      await handler(req, res);

      const secondCall = pool.query.mock.calls[1];
      expect(secondCall[1]).toEqual([5]);
    });

    it('should cap limit at 100', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes({}, { limit: '999' });
      await handler(req, res);

      const secondCall = pool.query.mock.calls[1];
      expect(secondCall[1]).toEqual([100]);
    });
  });

  describe('GET /runs/:runId', () => {
    const handler = getHandler('get', '/runs/:runId');

    it('should return run detail with 11 checkpoints', async () => {
      pool.query.mockResolvedValue({
        rows: [{
          id: 'task-abc',
          title: '实现登录功能',
          status: 'in_progress',
          payload: { current_step: '5', prd_path: '/tmp/login.md', run_status: 'triggered' },
          started_at: new Date('2026-02-05T10:00:00Z'),
          updated_at: new Date('2026-02-05T10:30:00Z'),
          completed_at: null,
        }],
      });

      const { req, res } = mockReqRes({ runId: 'task-abc' });
      await handler(req, res);

      expect(res._data.success).toBe(true);
      expect(res._data.run.id).toBe('task-abc');
      expect(res._data.run.project).toBe('实现登录功能');
      expect(res._data.run.status).toBe('running');
      expect(res._data.run.mode).toBe('headless');
      expect(res._data.run.completed_checkpoints).toBe(4);
      expect(res._data.run.current_checkpoint).toBe('写代码');
      expect(res._data.checkpoints).toHaveLength(11);
      // Steps 1-4 should be done
      expect(res._data.checkpoints[0].status).toBe('done');
      expect(res._data.checkpoints[3].status).toBe('done');
      // Step 5 should be in_progress
      expect(res._data.checkpoints[4].status).toBe('in_progress');
      // Steps 6-11 should be pending
      expect(res._data.checkpoints[5].status).toBe('pending');
      expect(res._data.checkpoints[10].status).toBe('pending');
    });

    it('should return error for non-existent task', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const { req, res } = mockReqRes({ runId: 'no-such-id' });
      await handler(req, res);

      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('任务不存在');
    });

    it('should show all checkpoints as done for completed task', async () => {
      pool.query.mockResolvedValue({
        rows: [{
          id: 'task-done',
          title: 'Done Task',
          status: 'completed',
          payload: {},
          started_at: new Date('2026-02-05T10:00:00Z'),
          updated_at: new Date('2026-02-05T11:00:00Z'),
          completed_at: new Date('2026-02-05T11:00:00Z'),
        }],
      });

      const { req, res } = mockReqRes({ runId: 'task-done' });
      await handler(req, res);

      expect(res._data.success).toBe(true);
      expect(res._data.run.completed_checkpoints).toBe(11);
      expect(res._data.checkpoints.every(cp => cp.status === 'done')).toBe(true);
    });

    it('should show failed step and skipped remaining for failed task', async () => {
      pool.query.mockResolvedValue({
        rows: [{
          id: 'task-fail',
          title: 'Failed Task',
          status: 'failed',
          payload: { current_step: '6' },
          started_at: new Date('2026-02-05T10:00:00Z'),
          updated_at: new Date('2026-02-05T10:30:00Z'),
          completed_at: null,
        }],
      });

      const { req, res } = mockReqRes({ runId: 'task-fail' });
      await handler(req, res);

      expect(res._data.success).toBe(true);
      expect(res._data.run.status).toBe('failed');
      expect(res._data.run.failed_checkpoints).toBe(1);
      // Steps 1-5 done
      expect(res._data.checkpoints[4].status).toBe('done');
      // Step 6 failed
      expect(res._data.checkpoints[5].status).toBe('failed');
      // Steps 7-11 skipped
      expect(res._data.checkpoints[6].status).toBe('skipped');
      expect(res._data.checkpoints[10].status).toBe('skipped');
    });

    it('should handle queued task with all pending checkpoints', async () => {
      pool.query.mockResolvedValue({
        rows: [{
          id: 'task-q',
          title: 'Queued',
          status: 'queued',
          payload: {},
          started_at: null,
          updated_at: new Date(),
          completed_at: null,
        }],
      });

      const { req, res } = mockReqRes({ runId: 'task-q' });
      await handler(req, res);

      expect(res._data.run.status).toBe('pending');
      expect(res._data.checkpoints.every(cp => cp.status === 'pending')).toBe(true);
    });
  });

  describe('status mapping', () => {
    const handler = getHandler('get', '/runs/:runId');

    async function getRunStatus(dbStatus) {
      pool.query.mockResolvedValue({
        rows: [{
          id: 'x', title: 'T', status: dbStatus,
          payload: {}, started_at: new Date(), updated_at: new Date(), completed_at: null,
        }],
      });
      const { req, res } = mockReqRes({ runId: 'x' });
      await handler(req, res);
      return res._data.run.status;
    }

    it('maps in_progress to running', async () => {
      expect(await getRunStatus('in_progress')).toBe('running');
    });

    it('maps queued to pending', async () => {
      expect(await getRunStatus('queued')).toBe('pending');
    });

    it('maps cancelled to failed', async () => {
      expect(await getRunStatus('cancelled')).toBe('failed');
    });

    it('maps completed to completed', async () => {
      expect(await getRunStatus('completed')).toBe('completed');
    });
  });
});
