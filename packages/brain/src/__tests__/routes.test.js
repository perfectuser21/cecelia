/**
 * Routes Unit Tests for Decomposition API Endpoints
 * Tests the new decomposition API endpoints in routes.js
 *
 * v2.0: getActiveExecutionPaths 和 INVENTORY_CONFIG 已从 decomposition-checker
 *       迁移到 routes.js 内部定义，测试通过 pool.query mock 控制行为。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../db.js', () => {
  const mockPool = {
    query: vi.fn(),
  };
  return { default: mockPool };
});

vi.mock('../decomposition-checker.js', () => ({
  runDecompositionChecks: vi.fn(),
}));

import pool from '../db.js';
import { runDecompositionChecks } from '../decomposition-checker.js';

// Import after mocking to avoid module loading issues
const { default: router } = await import('../routes.js');

// Helper: create mock req/res
function mockReqRes(params = {}, query = {}, body = {}) {
  const req = { params, query, body };
  const res = {
    _data: null,
    _status: 200,
    json(data) { this._data = data; return this; },
    status(code) { this._status = code; return this; },
  };
  return { req, res };
}

// Get route handlers from the router
function getHandler(method, path) {
  const layers = router.stack.filter(
    l => l.route && l.route.methods[method] && l.route.path === path
  );
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

describe('Decomposition API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /decomposition/missing', () => {
    const handler = getHandler('get', '/decomposition/missing');

    it('should return missing initiatives list', async () => {
      // pool.query call 1: getActiveExecutionPaths → returns initiatives
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'init-1', name: 'Initiative 1', kr_id: 'kr-1' },
            { id: 'init-2', name: 'Initiative 2', kr_id: 'kr-2' }
          ]
        })
        // pool.query call 2: task count for init-1 (below LOW_WATERMARK=3)
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        // pool.query call 3: task count for init-2 (at or above LOW_WATERMARK)
        .mockResolvedValueOnce({ rows: [{ count: '3' }] });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.missing_initiatives).toHaveLength(1);
      expect(res._data.missing_initiatives[0]).toMatchObject({
        initiative_id: 'init-1',
        initiative_name: 'Initiative 1',
        kr_id: 'kr-1',
        ready_tasks: 1,
        low_watermark: 3,
        target_tasks: 9
      });
      expect(res._data.total_active_paths).toBe(2);
    });

    it('should return empty list when all initiatives have sufficient tasks', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'init-1', name: 'Initiative 1', kr_id: 'kr-1' }]
        })
        .mockResolvedValueOnce({ rows: [{ count: '5' }] }); // Above watermark

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._data.missing_initiatives).toHaveLength(0);
    });

    it('should handle errors gracefully', async () => {
      pool.query.mockRejectedValueOnce(new Error('Database error'));

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.error).toBe('Database error');
    });
  });

  describe('POST /decomposition/create-missing', () => {
    const handler = getHandler('post', '/decomposition/create-missing');

    it('should trigger decomposition check and return results', async () => {
      const mockResult = {
        summary: { created: 2, skipped: 1 },
        actions: [
          { action: 'create_decomposition', check: 'inventory_replenishment', task_id: 'task-1' },
          { action: 'create_decomposition', check: 'initiative_decomposition', task_id: 'task-2' },
          { action: 'skip_inventory', check: 'inventory_replenishment' }
        ],
        active_paths: [{ id: 'init-1', name: 'Initiative 1' }],
        created_tasks: [{ id: 'task-1', initiative: 'Initiative 1' }]
      };

      runDecompositionChecks.mockResolvedValueOnce(mockResult);

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.created_tasks.total).toBe(2);
      expect(res._data.created_tasks.inventory_replenishment).toBe(1);
      expect(res._data.created_tasks.initiative_seeding).toBe(1);
    });

    it('should handle errors gracefully', async () => {
      runDecompositionChecks.mockRejectedValueOnce(new Error('Check failed'));

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.error).toBe('Check failed');
    });
  });

  describe('GET /decomposition/stats', () => {
    const handler = getHandler('get', '/decomposition/stats');

    it('should return comprehensive decomposition statistics', async () => {
      pool.query
        // Call 1: getActiveExecutionPaths → initiatives
        .mockResolvedValueOnce({
          rows: [
            { id: 'init-1', name: 'Initiative 1', kr_id: 'kr-1' },
            { id: 'init-2', name: 'Initiative 2', kr_id: 'kr-2' }
          ]
        })
        // Call 2: Decomposition tasks stats
        .mockResolvedValueOnce({
          rows: [{ total: '10', queued: '3', in_progress: '2', completed: '5' }]
        })
        // Call 3: Task count for init-1 (below LOW_WATERMARK=3)
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        // Call 4: Task count for init-2 (above LOW_WATERMARK)
        .mockResolvedValueOnce({ rows: [{ count: '4' }] })
        // Call 5: Project stats
        .mockResolvedValueOnce({
          rows: [
            { type: 'project', status: 'active', count: '5' },
            { type: 'initiative', status: 'active', count: '8' },
            { type: 'initiative', status: 'completed', count: '3' }
          ]
        });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.summary.active_execution_paths).toBe(2);
      expect(res._data.summary.low_inventory_initiatives).toBe(1);
      expect(res._data.decomposition_tasks).toMatchObject({
        total: '10',
        queued: '3',
        in_progress: '2',
        completed: '5'
      });
      expect(res._data.inventory_stats).toHaveLength(2);
      expect(res._data.inventory_stats[0].is_low_inventory).toBe(true);
      expect(res._data.inventory_stats[1].is_low_inventory).toBe(false);
      expect(res._data.config).toMatchObject({
        low_watermark: 3,
        target_ready_tasks: 9,
        batch_size: 3
      });
    });

    it('should handle errors gracefully', async () => {
      pool.query.mockRejectedValueOnce(new Error('Stats error'));

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.error).toBe('Stats error');
    });
  });
});
