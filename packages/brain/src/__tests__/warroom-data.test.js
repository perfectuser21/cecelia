/**
 * Tests for warroom-data routes (relay-baton4 item1)
 *
 * GET /api/brain/handoffs
 * GET /api/brain/sentinel/health
 * GET /api/brain/decisions/recent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../scheduler-jobs.js', () => ({
  SENTINEL_KEY_PREFIX: 'scheduler_job_last_run:',
  JOBS: [
    { name: 'arch-review' },
    { name: 'strategy-trigger' },
    { name: 'conversation-digest' },
    { name: 'capture-digestion' },
    { name: 'daily-backup' },
  ],
}));

describe('GET /handoffs', () => {
  let pool, app, request;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    vi.mock('../scheduler-jobs.js', () => ({
      SENTINEL_KEY_PREFIX: 'scheduler_job_last_run:',
      JOBS: Array.from({ length: 5 }, (_, i) => ({ name: `job-${i}` })),
    }));

    const dbModule = await import('../db.js');
    pool = dbModule.default;

    const supertest = (await import('supertest')).default;
    const express = (await import('express')).default;
    const warroomDataRouter = (await import('../routes/warroom-data.js')).default;
    app = express();
    app.use('/api/brain', warroomDataRouter);
    request = supertest(app);
  });

  it('返回 handoff 摘要列表（无过滤）', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'task-001',
          title: '实现登录功能',
          status: 'completed',
          task_type: 'dev',
          handoff: { task_id: 'task-001', verdict: 'pass', done: ['登录页完成'] },
          created_at: '2026-07-01T10:00:00Z',
          updated_at: '2026-07-01T12:00:00Z',
        },
      ],
    });

    const res = await request.get('/api/brain/handoffs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].task_id).toBe('task-001');
    expect(res.body.data[0].handoff.verdict).toBe('pass');
    expect(res.body.total).toBe(1);
  });

  it('按 journey_id 过滤', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request.get('/api/brain/handoffs?journey_id=jrn-123&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // SQL 应包含 journey_id 条件
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/journey_id/);
    expect(params).toContain('jrn-123');
    expect(params).toContain(5);
  });

  it('limit 上限 clamp 到 100', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request.get('/api/brain/handoffs?limit=999');
    expect(res.status).toBe(200);
    const params = pool.query.mock.calls[0][1];
    expect(params[params.length - 1]).toBe(100);
  });

  it('DB 失败返回 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db error'));
    const res = await request.get('/api/brain/handoffs');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /sentinel/health', () => {
  let pool, app, request;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    vi.mock('../scheduler-jobs.js', () => ({
      SENTINEL_KEY_PREFIX: 'scheduler_job_last_run:',
      JOBS: Array.from({ length: 5 }, (_, i) => ({ name: `job-${i}` })),
    }));

    const dbModule = await import('../db.js');
    pool = dbModule.default;

    const supertest = (await import('supertest')).default;
    const express = (await import('express')).default;
    const warroomDataRouter = (await import('../routes/warroom-data.js')).default;
    app = express();
    app.use('/api/brain', warroomDataRouter);
    request = supertest(app);
  });

  it('全部 job 运行 ok → healthy=true', async () => {
    // 第一次调用：scheduler_jobs_expected
    pool.query.mockResolvedValueOnce({ rows: [{ value_json: { count: 2 } }] });
    // 第二次调用：哨兵列表
    pool.query.mockResolvedValueOnce({
      rows: [
        { key: 'scheduler_job_last_run:arch-review', value_json: { at: '2026-07-07T01:00:00Z', ok: true }, updated_at: '2026-07-07T01:00:00Z' },
        { key: 'scheduler_job_last_run:strategy-trigger', value_json: { at: '2026-07-07T01:00:00Z', ok: true }, updated_at: '2026-07-07T01:00:00Z' },
      ],
    });

    const res = await request.get('/api/brain/sentinel/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.expected).toBe(2);
    expect(res.body.data.actual).toBe(2);
    expect(res.body.data.healthy).toBe(true);
    expect(res.body.data.jobs).toHaveLength(2);
  });

  it('有 job 失败 → healthy=false', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ value_json: { count: 2 } }] });
    pool.query.mockResolvedValueOnce({
      rows: [
        { key: 'scheduler_job_last_run:arch-review', value_json: { at: '2026-07-07T01:00:00Z', ok: false, error: 'timeout' }, updated_at: '2026-07-07T01:00:00Z' },
        { key: 'scheduler_job_last_run:strategy-trigger', value_json: { at: '2026-07-07T01:00:00Z', ok: true }, updated_at: '2026-07-07T01:00:00Z' },
      ],
    });

    const res = await request.get('/api/brain/sentinel/health');
    expect(res.status).toBe(200);
    expect(res.body.data.healthy).toBe(false);
    expect(res.body.data.jobs[0].error).toBe('timeout');
  });

  it('哨兵数少于预期 → healthy=false', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ value_json: { count: 5 } }] });
    pool.query.mockResolvedValueOnce({
      rows: [
        { key: 'scheduler_job_last_run:arch-review', value_json: { at: '2026-07-07T01:00:00Z', ok: true }, updated_at: '2026-07-07T01:00:00Z' },
      ],
    });

    const res = await request.get('/api/brain/sentinel/health');
    expect(res.status).toBe(200);
    expect(res.body.data.healthy).toBe(false);
    expect(res.body.data.expected).toBe(5);
    expect(res.body.data.actual).toBe(1);
  });

  it('expected 记录缺失时回落 JOBS.length（返回合法响应）', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // scheduler_jobs_expected 不存在
    pool.query.mockResolvedValueOnce({ rows: [] }); // 哨兵列表为空

    const res = await request.get('/api/brain/sentinel/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.expected).toBe('number');
    expect(res.body.data.actual).toBe(0);
  });

  it('DB 失败返回 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('pg error'));
    const res = await request.get('/api/brain/sentinel/health');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /decisions/recent', () => {
  let pool, app, request;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    vi.mock('../scheduler-jobs.js', () => ({
      SENTINEL_KEY_PREFIX: 'scheduler_job_last_run:',
      JOBS: [],
    }));

    const dbModule = await import('../db.js');
    pool = dbModule.default;

    const supertest = (await import('supertest')).default;
    const express = (await import('express')).default;
    const warroomDataRouter = (await import('../routes/warroom-data.js')).default;
    app = express();
    app.use('/api/brain', warroomDataRouter);
    request = supertest(app);
  });

  it('返回最近决策列表', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 'dec-1', topic: '数据库选型', decision: '使用 PostgreSQL', made_by: 'user', created_at: '2026-07-01' },
      ],
    });

    const res = await request.get('/api/brain/decisions/recent');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].topic).toBe('数据库选型');
    expect(res.body.total).toBe(1);
  });

  it('made_by 过滤生效', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request.get('/api/brain/decisions/recent?made_by=user&limit=10');
    expect(res.status).toBe(200);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/made_by/);
    expect(params).toContain('user');
    expect(params).toContain(10);
  });

  it('limit 上限 clamp 到 200', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request.get('/api/brain/decisions/recent?limit=9999');
    expect(res.status).toBe(200);
    const params = pool.query.mock.calls[0][1];
    expect(params[params.length - 1]).toBe(200);
  });

  it('DB 失败返回 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db error'));
    const res = await request.get('/api/brain/decisions/recent');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
