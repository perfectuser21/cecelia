/**
 * content-library.test.js
 *
 * 内容库路由单元测试
 *
 * 覆盖范围：
 *   - PATCH /:id/review：COALESCE 防御修复（payload = COALESCE(payload,'{}'::jsonb) || patch）
 *   - PATCH /:id/review：status 校验、成功返回、404 处理
 *   - GET /：列表查询（date 过滤、review_status 过滤）
 *   - GET /stats：统计查询返回结构
 *
 * Sprint: 07220725-fix-markdispatched-null-payload
 * Task ID: 2faafa72-9358-4057-b1e6-6f5a67133ed7
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Mock pool — hoisted 确保 content-library.js 加载时获得 mockQuery
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

// supertest 用于路由测试
import express from 'express';
import request from 'supertest';

let app;

beforeAll(async () => {
  vi.resetModules();
  const { default: router } = await import('../content-library.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain/content-library', router);
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── PATCH /:id/review ───────────────────────────────────────────────────────

describe('PATCH /api/brain/content-library/:id/review', () => {
  it('status 非法时返回 400', async () => {
    const res = await request(app)
      .patch('/api/brain/content-library/uuid-1/review')
      .send({ status: 'invalid-status' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status 必须是/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('approved 时调用 UPDATE 包含 COALESCE 防御写法', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'uuid-1', title: '测试文章', review_status: 'approved' }],
    });

    const res = await request(app)
      .patch('/api/brain/content-library/uuid-1/review')
      .send({ status: 'approved', feedback: '内容优秀' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.review_status).toBe('approved');
    expect(res.body.feedback).toBe('内容优秀');

    // 验证 SQL 包含 COALESCE 防御写法
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('COALESCE(payload');
    expect(sql).toContain('UPDATE tasks');
    expect(sql).toContain("AND task_type = 'content-pipeline'");

    // 验证 patch 内容结构
    const reviewPatch = JSON.parse(params[0]);
    expect(reviewPatch.review_status).toBe('approved');
    expect(reviewPatch.review_feedback).toBe('内容优秀');
    expect(reviewPatch.reviewed_at).toBeTruthy();
  });

  it('rejected 时返回 200', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'uuid-2', title: '测试文章2', review_status: 'rejected' }],
    });

    const res = await request(app)
      .patch('/api/brain/content-library/uuid-2/review')
      .send({ status: 'rejected' });

    expect(res.status).toBe(200);
    expect(res.body.review_status).toBe('rejected');
    // feedback 缺省时为 null
    expect(res.body.feedback).toBeNull();
  });

  it('needs-revision 时返回 200', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'uuid-3', title: '测试文章3', review_status: 'needs-revision' }],
    });

    const res = await request(app)
      .patch('/api/brain/content-library/uuid-3/review')
      .send({ status: 'needs-revision', feedback: '需要修改标题' });

    expect(res.status).toBe(200);
    expect(res.body.review_status).toBe('needs-revision');
  });

  it('Pipeline 不存在时返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(app)
      .patch('/api/brain/content-library/nonexistent/review')
      .send({ status: 'approved' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/不存在/);
  });

  it('DB 异常时返回 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));

    const res = await request(app)
      .patch('/api/brain/content-library/uuid-1/review')
      .send({ status: 'approved' });

    expect(res.status).toBe(500);
  });
});

// ─── GET / ──────────────────────────────────────────────────────────────────

describe('GET /api/brain/content-library', () => {
  it('无参数时返回列表', async () => {
    const fakeRows = [
      {
        id: 'pipe-1',
        title: '文章1',
        payload: { pipeline_keyword: '美妆', content_type: 'short-video', review_status: 'approved' },
        created_at: new Date('2026-07-22T00:00:00Z'),
      },
    ];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const res = await request(app).get('/api/brain/content-library');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].keyword).toBe('美妆');
    expect(res.body.data[0].review_status).toBe('approved');
  });

  it('review_status=pending_review 时查询 IS NULL 条件', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/brain/content-library?review_status=pending_review');

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('pending_review');
  });

  it('DB 异常时返回 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));

    const res = await request(app).get('/api/brain/content-library');

    expect(res.status).toBe(500);
  });
});

// ─── GET /stats ──────────────────────────────────────────────────────────────

describe('GET /api/brain/content-library/stats', () => {
  it('返回最近7天统计结构', async () => {
    const fakeRows = [
      {
        date: '2026-07-22',
        total_completed: '5',
        approved: '3',
        rejected: '1',
        needs_revision: '0',
        pending_review: '1',
      },
    ];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const res = await request(app).get('/api/brain/content-library/stats');

    expect(res.status).toBe(200);
    expect(res.body.stats).toHaveLength(1);
    expect(res.body.kr_target).toBe(3);
    expect(res.body.stats[0].total_completed).toBe(5);
    expect(res.body.stats[0].met_target).toBe(true);
    expect(res.body.summary.days_tracked).toBe(1);
    expect(res.body.summary.days_met_target).toBe(1);
  });

  it('产出不达标时 met_target=false', async () => {
    const fakeRows = [
      {
        date: '2026-07-21',
        total_completed: '2',
        approved: '1',
        rejected: '0',
        needs_revision: '0',
        pending_review: '1',
      },
    ];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const res = await request(app).get('/api/brain/content-library/stats');

    expect(res.body.stats[0].met_target).toBe(false);
    expect(res.body.summary.days_met_target).toBe(0);
  });

  it('DB 异常时返回 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));

    const res = await request(app).get('/api/brain/content-library/stats');

    expect(res.status).toBe(500);
  });
});
