/**
 * C2: POST /tasks schema normalize 测试
 *
 * 直接测试 task-tasks.js 的 normalize 逻辑，不走 HTTP（避免 supertest 依赖）。
 * 做法：import router，构造 mock req/res，调用 POST handler。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

// Mock domain-detector
vi.mock('../domain-detector.js', () => ({
  detectDomain: () => ({ domain: 'growth' }),
}));

// Mock task-updater
vi.mock('../task-updater.js', () => ({
  blockTask: vi.fn(),
}));

// Mock quarantine
vi.mock('../quarantine.js', () => ({
  classifyFailure: vi.fn(),
  FAILURE_CLASS: { NETWORK: 'network', RATE_LIMIT: 'rate_limit', BILLING_CAP: 'billing_cap', AUTH: 'auth', RESOURCE: 'resource' },
}));

// Import router to extract POST handler
const { default: router } = await import('../routes/task-tasks.js');

// Find the POST / handler from the router stack
function findPostHandler() {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === '/' && layer.route.methods.post) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error('POST / handler not found in router');
}

const postHandler = findPostHandler();

// Mock req/res factory
function mockReqRes(body) {
  const req = { body };
  const res = {
    _status: 200,
    _json: null,
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; return this; },
  };
  return { req, res };
}

describe('POST /tasks schema normalize (C2)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({
      rows: [{
        id: 'test-uuid', title: 'Test', status: 'queued', task_type: 'dev',
        priority: 'P2', project_id: null, area_id: null, goal_id: null,
        okr_initiative_id: null, created_at: '2026-04-16T00:00:00Z',
      }],
    });
  });

  describe('payload.prd_summary → description fallback', () => {
    it('copies payload.prd_summary to description when description is null', async () => {
      const { req, res } = mockReqRes({
        title: 'Test Task',
        description: null,
        payload: { prd_summary: 'PRD from payload field' },
      });
      await postHandler(req, res);
      expect(res._status).toBe(201);
      // description is param index 1 (title=0, description=1)
      const params = mockQuery.mock.calls[0][1];
      expect(params[1]).toBe('PRD from payload field');
    });

    it('keeps original description when both are present', async () => {
      const { req, res } = mockReqRes({
        title: 'Test',
        description: 'Original',
        payload: { prd_summary: 'Should NOT override' },
      });
      await postHandler(req, res);
      expect(res._status).toBe(201);
      expect(mockQuery.mock.calls[0][1][1]).toBe('Original');
    });

    it('leaves description null when both are absent', async () => {
      const { req, res } = mockReqRes({ title: 'Test' });
      await postHandler(req, res);
      expect(res._status).toBe(201);
      expect(mockQuery.mock.calls[0][1][1]).toBeNull();
    });
  });

  describe('priority normalize', () => {
    it('normalizes "normal" to P2', async () => {
      const { req, res } = mockReqRes({ title: 'Test', priority: 'normal' });
      await postHandler(req, res);
      expect(res._status).toBe(201);
      expect(mockQuery.mock.calls[0][1][2]).toBe('P2');
    });

    it('normalizes "high" to P1', async () => {
      const { req, res } = mockReqRes({ title: 'Test', priority: 'high' });
      await postHandler(req, res);
      expect(res._status).toBe(201);
      expect(mockQuery.mock.calls[0][1][2]).toBe('P1');
    });

    it('normalizes "urgent" to P0', async () => {
      const { req, res } = mockReqRes({ title: 'Test', priority: 'urgent' });
      await postHandler(req, res);
      expect(res._status).toBe(201);
      expect(mockQuery.mock.calls[0][1][2]).toBe('P0');
    });

    it('normalizes "Critical" to P0 (case-insensitive)', async () => {
      const { req, res } = mockReqRes({ title: 'Test', priority: 'Critical' });
      await postHandler(req, res);
      expect(res._status).toBe(201);
      expect(mockQuery.mock.calls[0][1][2]).toBe('P0');
    });

    it('passes P0/P1/P2 through unchanged', async () => {
      for (const p of ['P0', 'P1', 'P2']) {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'x', title: 'T', status: 'queued', task_type: 'dev', priority: p, project_id: null, area_id: null, goal_id: null, okr_initiative_id: null, created_at: '2026' }],
        });
        const { req, res } = mockReqRes({ title: 'Test', priority: p });
        await postHandler(req, res);
        expect(res._status).toBe(201);
      }
    });

    it('rejects unknown priority "foo-bar" with 400', async () => {
      const { req, res } = mockReqRes({ title: 'Test', priority: 'foo-bar' });
      await postHandler(req, res);
      expect(res._status).toBe(400);
      expect(res._json.error).toContain('Invalid priority');
      expect(res._json.allowed).toEqual(['P0', 'P1', 'P2']);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
