/**
 * Capabilities API Unit Tests
 * Tests Capability-Driven Development API endpoints
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
import routes from '../routes.js';

// Helper: create mock req/res
function mockReqRes(body = {}, params = {}, query = {}) {
  const req = { body, params, query };
  const res = {
    _status: 200,
    _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}

// Get route handlers from the router
function getHandler(method, path) {
  const layers = routes.stack.filter(
    l => l.route && l.route.methods[method] && l.route.path === path
  );
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

describe('Capabilities API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /capabilities', () => {
    const handler = getHandler('get', '/capabilities');

    it('should list all capabilities', async () => {
      const mockCapabilities = [
        {
          id: 'autonomous-task-scheduling',
          name: '自主任务调度与派发',
          description: '系统能从 PostgreSQL 队列中...',
          current_stage: 3,
          related_repos: ['/home/xx/perfect21/cecelia/core'],
          related_skills: ['dev', 'review'],
          key_tables: ['tasks', 'task_runs'],
          evidence: '连续 7 天成功率 > 90%',
          owner: 'system',
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 'three-layer-brain',
          name: '三层大脑决策架构',
          description: 'L0 脑干 + L1 丘脑 + L2 皮层',
          current_stage: 3,
          related_repos: ['/home/xx/perfect21/cecelia/core'],
          related_skills: ['cecelia-brain'],
          key_tables: ['thalamus_decisions', 'cortex_analyses'],
          owner: 'system',
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      pool.query.mockResolvedValueOnce({ rows: mockCapabilities });

      const { req, res } = mockReqRes({}, {}, {});

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.capabilities).toHaveLength(2);
      expect(res._data.count).toBe(2);
      expect(res._data.capabilities[0].id).toBe('autonomous-task-scheduling');
    });

    it('should filter by current_stage', async () => {
      const mockCapabilities = [
        {
          id: 'test-capability',
          name: 'Test',
          current_stage: 2,
          owner: 'system',
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      pool.query.mockResolvedValueOnce({ rows: mockCapabilities });

      const { req, res } = mockReqRes({}, {}, { current_stage: '2' });

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('current_stage = $1'),
        expect.arrayContaining([2])
      );
    });

    it('should handle errors gracefully', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB error'));

      const { req, res } = mockReqRes();

      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Failed to list capabilities');
    });
  });

  describe('GET /capabilities/:id', () => {
    const handler = getHandler('get', '/capabilities/:id');

    it('should get single capability by ID', async () => {
      const mockCapability = {
        id: 'autonomous-task-scheduling',
        name: '自主任务调度与派发',
        description: '系统能从 PostgreSQL 队列中...',
        current_stage: 3,
        related_repos: ['/home/xx/perfect21/cecelia/core'],
        related_skills: ['dev', 'review'],
        key_tables: ['tasks', 'task_runs'],
        owner: 'system',
        created_at: new Date(),
        updated_at: new Date()
      };

      pool.query.mockResolvedValueOnce({ rows: [mockCapability] });

      const { req, res } = mockReqRes({}, { id: 'autonomous-task-scheduling' });

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.capability.id).toBe('autonomous-task-scheduling');
    });

    it('should return 404 for non-existent capability', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes({}, { id: 'nonexistent' });

      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.success).toBe(false);
      expect(res._data.code).toBe('CAPABILITY_NOT_FOUND');
    });
  });

  describe('POST /capabilities', () => {
    const handler = getHandler('post', '/capabilities');

    it('should create capability successfully', async () => {
      const mockCapability = {
        id: 'test-capability',
        name: 'Test Capability',
        description: 'Test description',
        current_stage: 1,
        related_repos: ['/test/repo'],
        owner: 'system',
        created_at: new Date(),
        updated_at: new Date()
      };

      // Mock duplicate check (no existing) + insert
      pool.query
        .mockResolvedValueOnce({ rows: [] })                // duplicate check
        .mockResolvedValueOnce({ rows: [mockCapability] }); // insert

      const { req, res } = mockReqRes({
        id: 'test-capability',
        name: 'Test Capability',
        description: 'Test description',
        current_stage: 1,
        related_repos: ['/test/repo']
      });

      await handler(req, res);

      expect(res._status).toBe(201);
      expect(res._data.success).toBe(true);
      expect(res._data.capability.id).toBe('test-capability');
    });

    it('should reject missing id field', async () => {
      const { req, res } = mockReqRes({
        name: 'Test Capability'
      });

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.code).toBe('MISSING_FIELD');
      expect(res._data.error).toContain('id');
    });

    it('should reject missing name field', async () => {
      const { req, res } = mockReqRes({
        id: 'test-capability'
      });

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.code).toBe('MISSING_FIELD');
      expect(res._data.error).toContain('name');
    });

    it('should reject invalid id format (uppercase)', async () => {
      const { req, res } = mockReqRes({
        id: 'Test-Capability',
        name: 'Test'
      });

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.code).toBe('INVALID_ID_FORMAT');
    });

    it('should reject invalid id format (spaces)', async () => {
      const { req, res } = mockReqRes({
        id: 'test capability',
        name: 'Test'
      });

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.code).toBe('INVALID_ID_FORMAT');
    });

    it('should reject invalid current_stage (< 1)', async () => {
      const { req, res } = mockReqRes({
        id: 'test-capability',
        name: 'Test',
        current_stage: 0
      });

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.code).toBe('INVALID_STAGE');
    });

    it('should reject invalid current_stage (> 4)', async () => {
      const { req, res } = mockReqRes({
        id: 'test-capability',
        name: 'Test',
        current_stage: 5
      });

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.code).toBe('INVALID_STAGE');
    });

    it('should reject duplicate ID', async () => {
      // Mock duplicate check (existing capability found)
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'test-capability' }] });

      const { req, res } = mockReqRes({
        id: 'test-capability',
        name: 'Test'
      });

      await handler(req, res);

      expect(res._status).toBe(409);
      expect(res._data.success).toBe(false);
      expect(res._data.code).toBe('DUPLICATE_ID');
    });
  });

  describe('PATCH /capabilities/:id', () => {
    const handler = getHandler('patch', '/capabilities/:id');

    it('should update capability stage successfully', async () => {
      const mockUpdated = {
        id: 'test-capability',
        name: 'Test',
        current_stage: 2,
        evidence: '测试通过',
        updated_at: new Date()
      };

      // Mock existence check + update
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'test-capability' }] }) // exists
        .mockResolvedValueOnce({ rows: [mockUpdated] });              // update

      const { req, res } = mockReqRes(
        {
          current_stage: 2,
          evidence: '测试通过'
        },
        { id: 'test-capability' }
      );

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.capability.current_stage).toBe(2);
      expect(res._data.capability.evidence).toBe('测试通过');
    });

    it('should return 404 for non-existent capability', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // not found

      const { req, res } = mockReqRes(
        { current_stage: 2 },
        { id: 'nonexistent' }
      );

      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.success).toBe(false);
      expect(res._data.code).toBe('CAPABILITY_NOT_FOUND');
    });

    it('should reject invalid stage value', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'test' }] }); // exists

      const { req, res } = mockReqRes(
        { current_stage: 5 },
        { id: 'test' }
      );

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.code).toBe('INVALID_STAGE');
    });

    it('should reject empty update', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'test' }] }); // exists

      const { req, res } = mockReqRes({}, { id: 'test' });

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.code).toBe('NO_UPDATES');
    });

    it('should update multiple fields', async () => {
      const mockUpdated = {
        id: 'test',
        current_stage: 3,
        evidence: 'New evidence',
        description: 'Updated description',
        updated_at: new Date()
      };

      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'test' }] })
        .mockResolvedValueOnce({ rows: [mockUpdated] });

      const { req, res } = mockReqRes(
        {
          current_stage: 3,
          evidence: 'New evidence',
          description: 'Updated description'
        },
        { id: 'test' }
      );

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.capability.current_stage).toBe(3);
      expect(res._data.capability.evidence).toBe('New evidence');
      expect(res._data.capability.description).toBe('Updated description');
    });
  });
});
