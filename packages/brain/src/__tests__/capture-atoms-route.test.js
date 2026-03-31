/**
 * Capture Atoms API Route Tests
 *
 * GET  /api/brain/capture-atoms        — 列表查询（支持 status/capture_id 过滤）
 * GET  /api/brain/capture-atoms/:id    — 单条查询
 * PATCH /api/brain/capture-atoms/:id  — confirm/dismiss 操作
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db.js 避免真实数据库连接
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

const MOCK_ATOM = {
  id: 'atom-uuid-1234',
  capture_id: 'capture-uuid-5678',
  content: '明天上午 10 点开会讨论 Q2 规划',
  target_type: 'task',
  target_subtype: 'action_item',
  suggested_area_id: null,
  status: 'pending_review',
  routed_to_table: null,
  routed_to_id: null,
  confidence: 0.85,
  created_at: '2026-03-31T00:00:00.000Z',
  updated_at: '2026-03-31T00:00:00.000Z',
  capture_content: '明天开会讨论Q2规划，下午写代码，晚上健身',
};

describe('capture-atoms route', () => {
  let app;
  let mockPool;

  beforeEach(async () => {
    vi.clearAllMocks();

    const dbModule = await import('../db.js');
    mockPool = dbModule.default;

    const captureAtomsRouter = (await import('../routes/capture-atoms.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/brain/capture-atoms', captureAtomsRouter);
  });

  // ─── GET / ───────────────────────────────────────────────────────────────

  describe('GET /api/brain/capture-atoms', () => {
    it('无过滤条件时返回所有 atoms', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [MOCK_ATOM] });

      const res = await request(app).get('/api/brain/capture-atoms');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].id).toBe(MOCK_ATOM.id);
      expect(res.body[0].target_type).toBe('task');
    });

    it('支持 status 过滤参数', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [MOCK_ATOM] });

      const res = await request(app).get('/api/brain/capture-atoms?status=pending_review');

      expect(res.status).toBe(200);
      const callArgs = mockPool.query.mock.calls[0];
      expect(callArgs[1]).toContain('pending_review');
    });

    it('支持 capture_id 过滤参数', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [MOCK_ATOM] });

      const res = await request(app).get('/api/brain/capture-atoms?capture_id=capture-uuid-5678');

      expect(res.status).toBe(200);
      const callArgs = mockPool.query.mock.calls[0];
      expect(callArgs[1]).toContain('capture-uuid-5678');
    });

    it('查询失败时返回 500', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const res = await request(app).get('/api/brain/capture-atoms');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Failed to list');
    });
  });

  // ─── GET /:id ─────────────────────────────────────────────────────────────

  describe('GET /api/brain/capture-atoms/:id', () => {
    it('返回单条 atom', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [MOCK_ATOM] });

      const res = await request(app).get('/api/brain/capture-atoms/' + MOCK_ATOM.id);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(MOCK_ATOM.id);
    });

    it('atom 不存在时返回 404', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/api/brain/capture-atoms/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  // ─── PATCH /:id ───────────────────────────────────────────────────────────

  describe('PATCH /api/brain/capture-atoms/:id', () => {
    it('action 不合法时返回 400', async () => {
      const res = await request(app)
        .patch('/api/brain/capture-atoms/' + MOCK_ATOM.id)
        .send({ action: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('action must be confirm or dismiss');
    });

    it('dismiss 操作更新 atom 状态为 dismissed', async () => {
      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };
      mockClient.query.mockResolvedValueOnce({});
      mockClient.query.mockResolvedValueOnce({ rows: [MOCK_ATOM] });
      mockClient.query.mockResolvedValueOnce({});
      mockClient.query.mockResolvedValueOnce({});
      mockPool.connect.mockResolvedValueOnce(mockClient);

      const res = await request(app)
        .patch('/api/brain/capture-atoms/' + MOCK_ATOM.id)
        .send({ action: 'dismiss' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('dismissed');
      expect(res.body.id).toBe(MOCK_ATOM.id);
    });

    it('atom 不存在时返回 404', async () => {
      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };
      mockClient.query.mockResolvedValueOnce({});
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({});
      mockPool.connect.mockResolvedValueOnce(mockClient);

      const res = await request(app)
        .patch('/api/brain/capture-atoms/nonexistent-id')
        .send({ action: 'dismiss' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('atom 状态不是 pending_review 时返回 400', async () => {
      const confirmedAtom = Object.assign({}, MOCK_ATOM, { status: 'confirmed' });
      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };
      mockClient.query.mockResolvedValueOnce({});
      mockClient.query.mockResolvedValueOnce({ rows: [confirmedAtom] });
      mockClient.query.mockResolvedValueOnce({});
      mockPool.connect.mockResolvedValueOnce(mockClient);

      const res = await request(app)
        .patch('/api/brain/capture-atoms/' + MOCK_ATOM.id)
        .send({ action: 'confirm' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('confirmed');
    });

    it('confirm 操作路由 task atom 到 tasks 表', async () => {
      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };
      mockClient.query.mockResolvedValueOnce({});
      mockClient.query.mockResolvedValueOnce({ rows: [MOCK_ATOM] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'task-new-123' }] });
      mockClient.query.mockResolvedValueOnce({});
      mockClient.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      mockClient.query.mockResolvedValueOnce({});
      mockClient.query.mockResolvedValueOnce({});
      mockPool.connect.mockResolvedValueOnce(mockClient);

      const res = await request(app)
        .patch('/api/brain/capture-atoms/' + MOCK_ATOM.id)
        .send({ action: 'confirm' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('confirmed');
      expect(res.body.routed_to_table).toBe('tasks');
      expect(res.body.routed_to_id).toBe('task-new-123');
    });
  });
});
