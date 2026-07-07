/**
 * routes/warroom-data.test.js — 战情室只读端点单测（mock pool）
 *
 * 覆盖：
 *   GET /handoffs
 *   GET /sentinel/health
 *   GET /decisions/recent
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

// scheduler-jobs.js 只需 SENTINEL_KEY_PREFIX + JOBS 常量
vi.mock('../../scheduler-jobs.js', () => ({
  SENTINEL_KEY_PREFIX: 'scheduler_job_last_run:',
  JOBS: [
    { name: 'arch-review' },
    { name: 'strategy-trigger' },
    { name: 'conversation-digest' },
    { name: 'capture-digestion' },
    { name: 'daily-backup' },
  ],
}));

let router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../warroom-data.js');
  router = mod.default;
});

function makeApp() {
  const a = express();
  a.use(express.json());
  a.use('/', router);
  return a;
}

// ─────────────────────────────────────────────
// GET /handoffs
// ─────────────────────────────────────────────
describe('GET /handoffs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回 handoff 摘要列表', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'task-1',
          title: '发布 PR',
          status: 'completed',
          task_type: 'harness_initiative',
          handoff: { summary: '已完成', journey_id: 'j1' },
          created_at: '2026-07-01T00:00:00Z',
          updated_at: '2026-07-01T01:00:00Z',
        },
      ],
    });

    const res = await request(makeApp()).get('/handoffs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].task_id).toBe('task-1');
    expect(res.body.data[0].handoff.summary).toBe('已完成');
  });

  it('journey_id 过滤透传给 SQL', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp()).get('/handoffs?journey_id=j99&limit=5');
    expect(res.status).toBe(200);
    // 验证 query 收到了 journey_id 参数
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(params).toContain('j99');
    expect(sql).toMatch(/journey_id/);
  });

  it('limit 最大截断为 100', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await request(makeApp()).get('/handoffs?limit=999');
    const [, params] = mockPool.query.mock.calls[0];
    expect(params[params.length - 1]).toBe(100);
  });

  it('DB 异常 → 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('conn error'));
    const res = await request(makeApp()).get('/handoffs');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─────────────────────────────────────────────
// GET /sentinel/health
// ─────────────────────────────────────────────
describe('GET /sentinel/health', () => {
  beforeEach(() => vi.clearAllMocks());

  it('全部 job ok → healthy:true', async () => {
    // 第一次查询：scheduler_jobs_expected
    mockPool.query.mockResolvedValueOnce({
      rows: [{ value_json: { count: 2 } }],
    });
    // 第二次查询：哨兵记录
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { key: 'scheduler_job_last_run:arch-review', value_json: { ok: true, at: '2026-07-07T00:00:00Z' }, updated_at: '2026-07-07T00:00:00Z' },
        { key: 'scheduler_job_last_run:strategy-trigger', value_json: { ok: true, at: '2026-07-07T00:01:00Z' }, updated_at: '2026-07-07T00:01:00Z' },
      ],
    });

    const res = await request(makeApp()).get('/sentinel/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.healthy).toBe(true);
    expect(res.body.data.expected).toBe(2);
    expect(res.body.data.jobs).toHaveLength(2);
    expect(res.body.data.jobs[0].name).toBe('arch-review');
  });

  it('某 job ok:false → healthy:false', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ value_json: { count: 1 } }] });
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { key: 'scheduler_job_last_run:arch-review', value_json: { ok: false, error: 'timeout' }, updated_at: '2026-07-07T00:00:00Z' },
      ],
    });

    const res = await request(makeApp()).get('/sentinel/health');
    expect(res.body.data.healthy).toBe(false);
    expect(res.body.data.jobs[0].ok).toBe(false);
  });

  it('无 scheduler_jobs_expected 记录 → fallback JOBS.length(5)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // expected 不存在
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 哨兵记录为空

    const res = await request(makeApp()).get('/sentinel/health');
    expect(res.status).toBe(200);
    // fallback = JOBS.length = 5（mock 中设定）
    expect(res.body.data.expected).toBe(5);
    // actual=0 < expected=5 → unhealthy
    expect(res.body.data.healthy).toBe(false);
  });

  it('DB 异常 → 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('db err'));
    const res = await request(makeApp()).get('/sentinel/health');
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────
// GET /decisions/recent
// ─────────────────────────────────────────────
describe('GET /decisions/recent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回决策列表', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'd1',
          category: 'arch',
          topic: 'API 设计',
          decision: '使用 REST',
          reason: '团队熟悉',
          status: 'active',
          confidence: 0.9,
          author: 'Alex',
          made_by: 'user',
          priority: 'P1',
          area: 'brain',
          decided_at: null,
          created_at: '2026-07-01T00:00:00Z',
          updated_at: '2026-07-01T00:00:00Z',
        },
      ],
    });

    const res = await request(makeApp()).get('/decisions/recent');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].id).toBe('d1');
  });

  it('made_by 过滤透传', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await request(makeApp()).get('/decisions/recent?made_by=user&limit=10');
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(params).toContain('user');
    expect(sql).toMatch(/made_by/);
  });

  it('limit 最大截断为 200', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await request(makeApp()).get('/decisions/recent?limit=9999');
    const [, params] = mockPool.query.mock.calls[0];
    expect(params[params.length - 1]).toBe(200);
  });

  it('DB 异常 → 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('db fail'));
    const res = await request(makeApp()).get('/decisions/recent');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
