/**
 * Execution Status API Tests
 * Tests for /api/brain/cecelia/overview, /api/brain/dev/tasks, /api/brain/dev/health
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockPool = {
  query: vi.fn(),
};
vi.mock('../db.js', () => ({ default: mockPool }));

// Mock executor
const mockExecutor = {
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
};
vi.mock('../executor.js', () => mockExecutor);

// Import router after mocks
const { default: router } = await import('../routes.js');

// Helper to simulate express request/response
function mockReqRes(method, path, body = {}, query = {}) {
  return new Promise((resolve) => {
    const req = { method, path, body, query, params: {} };
    const resData = { statusCode: 200, body: null };
    const res = {
      status: (code) => { resData.statusCode = code; return res; },
      json: (data) => { resData.body = data; resolve(resData); },
    };

    // Find matching route handler
    const layers = router.stack.filter(layer => {
      if (!layer.route) return false;
      const routePath = layer.route.path;
      const routeMethod = Object.keys(layer.route.methods)[0];
      return routePath === path && routeMethod === method.toLowerCase();
    });

    if (layers.length === 0) {
      resolve({ statusCode: 404, body: { error: 'Not found' } });
      return;
    }

    const handler = layers[0].route.stack[0].handle;
    handler(req, res).catch(err => {
      resData.statusCode = 500;
      resData.body = { error: err.message };
      resolve(resData);
    });
  });
}

describe('Execution Status API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /cecelia/overview', () => {
    it('should return overview with counts and recent runs', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ running: '2', completed: '10', failed: '1', total: '13' }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'task-1',
              project: 'Test Task',
              status: 'in_progress',
              priority: 'P1',
              task_type: 'dev',
              started_at: '2026-02-05T10:00:00Z',
              completed_at: null,
              run_id: 'run-1',
              run_status: 'triggered',
              last_result: null,
              feature_branch: 'cp-test',
            },
          ],
        });

      const result = await mockReqRes('GET', '/cecelia/overview');

      expect(result.statusCode).toBe(200);
      expect(result.body.success).toBe(true);
      expect(result.body.total_runs).toBe(13);
      expect(result.body.running).toBe(2);
      expect(result.body.completed).toBe(10);
      expect(result.body.failed).toBe(1);
      expect(result.body.recent_runs).toHaveLength(1);
      expect(result.body.recent_runs[0].project).toBe('Test Task');
    });

    it('should handle database errors gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB connection failed'));

      const result = await mockReqRes('GET', '/cecelia/overview');

      expect(result.statusCode).toBe(500);
      expect(result.body.success).toBe(false);
      expect(result.body.error).toContain('Failed to get cecelia overview');
    });
  });

  describe('GET /dev/health', () => {
    it('should return healthy status when all services are up', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ ok: 1 }] });

      const result = await mockReqRes('GET', '/dev/health');

      expect(result.statusCode).toBe(200);
      expect(result.body.success).toBe(true);
      expect(result.body.data.status).toBe('healthy');
      expect(result.body.data.executor.available).toBe(true);
      expect(result.body.data.database.connected).toBe(true);
    });

    it('should return degraded when executor is unavailable', async () => {
      mockExecutor.checkCeceliaRunAvailable.mockResolvedValueOnce({ available: false });
      mockPool.query.mockResolvedValueOnce({ rows: [{ ok: 1 }] });

      const result = await mockReqRes('GET', '/dev/health');

      expect(result.statusCode).toBe(200);
      expect(result.body.data.status).toBe('degraded');
    });
  });

  describe('GET /dev/tasks', () => {
    it('should return active dev tasks', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'task-1',
            title: 'Implement feature X',
            status: 'in_progress',
            priority: 'P1',
            task_type: 'dev',
            created_at: '2026-02-05T10:00:00Z',
            completed_at: null,
            payload: { feature_branch: 'cp-feature-x' },
            goal_title: 'Goal A',
            project_name: 'cecelia-core',
            repo_path: '/home/xx/dev/cecelia-core',
          },
        ],
      });

      const result = await mockReqRes('GET', '/dev/tasks');

      expect(result.statusCode).toBe(200);
      expect(result.body.success).toBe(true);
      expect(result.body.data).toHaveLength(1);
      expect(result.body.data[0].repo.name).toBe('cecelia-core');
      expect(result.body.data[0].branches.current).toBe('cp-feature-x');
      expect(result.body.data[0].steps.total).toBe(11);
    });

    it('should return empty array when no tasks', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await mockReqRes('GET', '/dev/tasks');

      expect(result.statusCode).toBe(200);
      expect(result.body.success).toBe(true);
      expect(result.body.data).toHaveLength(0);
      expect(result.body.count).toBe(0);
    });
  });

  describe('GET /dev/repos', () => {
    it('should return tracked repositories', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { name: 'cecelia-core', repo_path: '/home/xx/dev/cecelia-core' },
          { name: 'cecelia-workspace', repo_path: '/home/xx/dev/cecelia-workspace' },
        ],
      });

      const result = await mockReqRes('GET', '/dev/repos');

      expect(result.statusCode).toBe(200);
      expect(result.body.success).toBe(true);
      expect(result.body.data).toHaveLength(2);
    });
  });
});
