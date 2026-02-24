/**
 * Desires API Tests
 * GET /api/brain/desires
 * GET /api/brain/desires/stats
 * PATCH /api/brain/desires/:id
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

import pool from '../db.js';
import router from '../routes.js';

const app = express();
app.use(express.json());
app.use('/api', router);

const mockDesires = [
  { id: 'uuid-1', type: 'warn', content: '任务失败率上升', insight: '失败4次', proposed_action: '检查executor', urgency: 9, evidence: {}, status: 'pending', created_at: new Date().toISOString(), expires_at: null },
  { id: 'uuid-2', type: 'inform', content: '今日完成35个任务', insight: null, proposed_action: '无需操作', urgency: 3, evidence: {}, status: 'pending', created_at: new Date().toISOString(), expires_at: null },
  { id: 'uuid-3', type: 'propose', content: '建议增加并发', insight: '执行层有余量', proposed_action: '调整max_concurrent', urgency: 6, evidence: {}, status: 'pending', created_at: new Date().toISOString(), expires_at: null },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/brain/desires', () => {
  it('返回 pending desires', async () => {
    pool.query.mockResolvedValueOnce({ rows: mockDesires });

    const res = await request(app).get('/api/brain/desires');

    expect(res.status).toBe(200);
    expect(res.body.desires).toHaveLength(3);
    expect(res.body.total).toBe(3);
  });

  it('支持 type 筛选', async () => {
    pool.query.mockResolvedValueOnce({ rows: [mockDesires[0]] });

    const res = await request(app).get('/api/brain/desires?type=warn');

    expect(res.status).toBe(200);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('type = $');
    expect(params).toContain('warn');
  });

  it('status=all 不加 status 过滤条件', async () => {
    pool.query.mockResolvedValueOnce({ rows: mockDesires });

    await request(app).get('/api/brain/desires?status=all');

    const [sql] = pool.query.mock.calls[0];
    expect(sql).not.toContain("status = $");
  });

  it('limit 超出 200 时截断为 200', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/brain/desires?limit=9999');

    const [, params] = pool.query.mock.calls[0];
    expect(params[params.length - 1]).toBe(200);
  });
});

describe('GET /api/brain/desires/stats', () => {
  it('返回各类型计数', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pending: '2', pending_decisions: '1', pending_warns: '1', pending_updates: '0', total: '3' }]
    });

    const res = await request(app).get('/api/brain/desires/stats');

    expect(res.status).toBe(200);
    expect(res.body.pending).toBe('2');
    expect(res.body.pending_warns).toBe('1');
  });
});

describe('PATCH /api/brain/desires/:id', () => {
  it('更新 status 为 expressed', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'uuid-1', status: 'expressed' }]
    });

    const res = await request(app)
      .patch('/api/brain/desires/uuid-1')
      .send({ status: 'expressed' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.desire.status).toBe('expressed');
  });

  it('拒绝非法 status 返回 400', async () => {
    const res = await request(app)
      .patch('/api/brain/desires/uuid-1')
      .send({ status: 'deleted' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('status must be one of');
  });

  it('desire 不存在时返回 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/api/brain/desires/nonexistent')
      .send({ status: 'suppressed' });

    expect(res.status).toBe(404);
  });
});
