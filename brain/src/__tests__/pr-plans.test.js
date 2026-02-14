/**
 * PR Plans API Unit Tests
 * Tests Layer 2 (工程规划层) PR Plans API endpoints
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

describe('PR Plans API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /pr-plans', () => {
    const handler = getHandler('post', '/pr-plans');

    it('should create PR Plan successfully', async () => {
      const mockPrPlan = {
        id: 'pr-plan-1',
        project_id: 'project-1',
        title: 'Add authentication',
        description: 'Implement JWT authentication',
        dod: '- [ ] User can login\n- [ ] Token expires after 1 hour',
        files: ['src/auth.js', 'src/middleware/auth.js'],
        sequence: 1,
        depends_on: null,
        complexity: 'medium',
        estimated_hours: 5,
        status: 'planning',
        created_at: new Date(),
        updated_at: new Date()
      };

      // Mock project existence check + insert
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'project-1' }] })    // project exists
        .mockResolvedValueOnce({ rows: [mockPrPlan] });             // insert result

      const { req, res } = mockReqRes({
        project_id: 'project-1',
        title: 'Add authentication',
        description: 'Implement JWT authentication',
        dod: '- [ ] User can login\n- [ ] Token expires after 1 hour',
        files: ['src/auth.js', 'src/middleware/auth.js'],
        sequence: 1,
        complexity: 'medium',
        estimated_hours: 5
      });

      await handler(req, res);

      expect(res._status).toBe(201);
      expect(res._data.success).toBe(true);
      expect(res._data.pr_plan).toEqual(mockPrPlan);
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it('should return 400 if project_id is missing', async () => {
      const { req, res } = mockReqRes({
        title: 'Add authentication',
        dod: 'DoD content'
      });

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Missing required field: project_id');
    });

    it('should return 400 if title is missing', async () => {
      const { req, res } = mockReqRes({
        project_id: 'project-1',
        dod: 'DoD content'
      });

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Missing required field: title');
    });

    it('should return 400 if dod is missing', async () => {
      const { req, res } = mockReqRes({
        project_id: 'project-1',
        title: 'Add authentication'
      });

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Missing required field: dod');
    });

    it('should return 404 if project does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // project not found

      const { req, res } = mockReqRes({
        project_id: 'invalid-project',
        title: 'Add authentication',
        dod: 'DoD content'
      });

      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Project not found');
      expect(res._data.code).toBe('PROJECT_NOT_FOUND');
    });

    it('should return 400 if complexity is invalid', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'project-1' }] });

      const { req, res } = mockReqRes({
        project_id: 'project-1',
        title: 'Add authentication',
        dod: 'DoD content',
        complexity: 'invalid'
      });

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Invalid complexity value');
      expect(res._data.code).toBe('INVALID_COMPLEXITY');
      expect(res._data.allowed).toEqual(['small', 'medium', 'large']);
    });
  });

  describe('GET /pr-plans', () => {
    const handler = getHandler('get', '/pr-plans');

    it('should query all PR Plans', async () => {
      const mockPrPlans = [
        { id: 'pr-plan-1', title: 'Plan 1', status: 'planning', sequence: 1 },
        { id: 'pr-plan-2', title: 'Plan 2', status: 'in_progress', sequence: 2 }
      ];

      pool.query.mockResolvedValueOnce({ rows: mockPrPlans });

      const { req, res } = mockReqRes();

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.pr_plans).toEqual(mockPrPlans);
      expect(res._data.count).toBe(2);
    });

    it('should filter by project_id', async () => {
      const mockPrPlans = [
        { id: 'pr-plan-1', project_id: 'project-1', title: 'Plan 1' }
      ];

      pool.query.mockResolvedValueOnce({ rows: mockPrPlans });

      const { req, res } = mockReqRes({}, {}, { project_id: 'project-1' });

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.pr_plans).toEqual(mockPrPlans);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('project_id = $1'),
        ['project-1']
      );
    });

    it('should filter by status', async () => {
      const mockPrPlans = [
        { id: 'pr-plan-1', status: 'completed', title: 'Plan 1' }
      ];

      pool.query.mockResolvedValueOnce({ rows: mockPrPlans });

      const { req, res } = mockReqRes({}, {}, { status: 'completed' });

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.pr_plans).toEqual(mockPrPlans);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('status = $1'),
        ['completed']
      );
    });
  });

  describe('GET /pr-plans/:id', () => {
    const handler = getHandler('get', '/pr-plans/:id');

    it('should get PR Plan with full context', async () => {
      const mockPrPlan = {
        pr_plan_id: 'pr-plan-1',
        pr_plan_title: 'Add authentication',
        dod: 'DoD content',
        project_id: 'project-1',
        project_name: 'API service',
        repo_path: '/repos/api-service',
        task_id: 'task-1',
        task_status: 'queued'
      };

      pool.query.mockResolvedValueOnce({ rows: [mockPrPlan] });

      const { req, res } = mockReqRes({}, { id: 'pr-plan-1' });

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.pr_plan).toEqual(mockPrPlan);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('pr_plan_full_context'),
        ['pr-plan-1']
      );
    });

    it('should return 404 if PR Plan not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes({}, { id: 'invalid-id' });

      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('PR Plan not found');
      expect(res._data.code).toBe('PR_PLAN_NOT_FOUND');
    });
  });

  describe('PATCH /pr-plans/:id', () => {
    const handler = getHandler('patch', '/pr-plans/:id');

    it('should update PR Plan successfully', async () => {
      const updatedPrPlan = {
        id: 'pr-plan-1',
        title: 'Updated title',
        status: 'in_progress',
        complexity: 'large'
      };

      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'pr-plan-1' }] })  // exists
        .mockResolvedValueOnce({ rows: [updatedPrPlan] });       // update result

      const { req, res } = mockReqRes(
        { title: 'Updated title', status: 'in_progress', complexity: 'large' },
        { id: 'pr-plan-1' }
      );

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.pr_plan).toEqual(updatedPrPlan);
    });

    it('should return 404 if PR Plan not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes(
        { status: 'completed' },
        { id: 'invalid-id' }
      );

      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('PR Plan not found');
    });

    it('should return 400 if status is invalid', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'pr-plan-1' }] });

      const { req, res } = mockReqRes(
        { status: 'invalid_status' },
        { id: 'pr-plan-1' }
      );

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Invalid status value');
      expect(res._data.code).toBe('INVALID_STATUS');
    });

    it('should return 400 if complexity is invalid', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'pr-plan-1' }] });

      const { req, res } = mockReqRes(
        { complexity: 'invalid' },
        { id: 'pr-plan-1' }
      );

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Invalid complexity value');
      expect(res._data.code).toBe('INVALID_COMPLEXITY');
    });

    it('should return 400 if no fields to update', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'pr-plan-1' }] });

      const { req, res } = mockReqRes({}, { id: 'pr-plan-1' });

      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('No fields to update');
      expect(res._data.code).toBe('NO_UPDATES');
    });
  });

  describe('DELETE /pr-plans/:id', () => {
    const handler = getHandler('delete', '/pr-plans/:id');

    it('should delete PR Plan successfully', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'pr-plan-1' }] });

      const { req, res } = mockReqRes({}, { id: 'pr-plan-1' });

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.message).toBe('PR Plan deleted successfully');
      expect(res._data.id).toBe('pr-plan-1');
    });

    it('should return 404 if PR Plan not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes({}, { id: 'invalid-id' });

      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('PR Plan not found');
      expect(res._data.code).toBe('PR_PLAN_NOT_FOUND');
    });
  });

  describe('Error Handling', () => {
    const postHandler = getHandler('post', '/pr-plans');

    it('should handle database errors gracefully', async () => {
      // First query (project check) succeeds, second (insert) fails
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'project-1' }] })
        .mockRejectedValueOnce(new Error('Database connection failed'));

      const { req, res } = mockReqRes({
        project_id: 'project-1',
        title: 'Test',
        dod: 'DoD content'
      });

      await postHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Failed to create PR Plan');
      expect(res._data.details).toBe('Database connection failed');
    });
  });
});
