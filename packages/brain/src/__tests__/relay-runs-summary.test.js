/**
 * GET /api/brain/orchestrator/relay-runs/summary 端点单元测试
 * TDD Red 阶段：端点未实现时全部 FAIL
 *
 * 覆盖：
 * B-01: 正常返回 200 + phases 含六个 key
 * B-02: 有数据时 phases count 正确
 * B-03: total === sum(phases values)
 * B-04: 无数据时 phases 全 0, total=0
 * B-05: 无数据返回 200 不报错
 * B-06: GET /relay-runs/summary 不被 :initiative_id 路由拦截
 * B-07: SQL 含 orchestrator_version = 'v2' 过滤
 * B-08: DB 异常 → 500 + {error: string}，不暴露内部信息
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: mockPool }));

let app;

async function buildApp() {
  vi.resetModules();
  const { default: router } = await import('../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildApp();
});

const ALL_PHASES = ['planning', 'gan', 'generate', 'evaluate', 'done', 'failed'];

describe('GET /api/brain/orchestrator/relay-runs/summary', () => {
  it('B-01: 返回 200，body.phases 含六个固定 key', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { phase: 'done', count: '3' },
        { phase: 'failed', count: '1' },
      ],
    });

    const res = await request(app).get('/api/brain/orchestrator/relay-runs/summary');

    expect(res.status).toBe(200);
    expect(res.body.phases).toBeDefined();
    for (const phase of ALL_PHASES) {
      expect(res.body.phases).toHaveProperty(phase);
    }
  });

  it('B-02: 有数据时 phases count 与 DB 数据一致', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { phase: 'done', count: '5' },
        { phase: 'generate', count: '2' },
      ],
    });

    const res = await request(app).get('/api/brain/orchestrator/relay-runs/summary');

    expect(res.status).toBe(200);
    expect(res.body.phases.done).toBe(5);
    expect(res.body.phases.generate).toBe(2);
    expect(res.body.phases.planning).toBe(0);
  });

  it('B-03: total === sum(phases values)', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { phase: 'done', count: '3' },
        { phase: 'failed', count: '2' },
        { phase: 'generate', count: '1' },
      ],
    });

    const res = await request(app).get('/api/brain/orchestrator/relay-runs/summary');

    const phaseSum = Object.values(res.body.phases).reduce((a, b) => a + b, 0);
    expect(res.body.total).toBe(phaseSum);
    expect(res.body.total).toBe(6);
  });

  it('B-04: DB 空结果 → phases 全 0, total=0', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/brain/orchestrator/relay-runs/summary');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    for (const phase of ALL_PHASES) {
      expect(res.body.phases[phase]).toBe(0);
    }
  });

  it('B-05: 无数据返回 200 不报错', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/brain/orchestrator/relay-runs/summary');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('error');
  });

  it('B-06: GET /relay-runs/summary 命中 summary 路由（不被 :initiative_id 拦截）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/brain/orchestrator/relay-runs/summary');

    // 若被 :initiative_id 路由拦截，会尝试查 summary 作为 UUID → DB 查不到 → 404 或 500
    // 正确的 summary 路由返回 200 且含 phases
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('phases');
    expect(res.body).toHaveProperty('total');
  });

  it('B-07: SQL 包含 orchestrator_version = \'v2\' 过滤', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/brain/orchestrator/relay-runs/summary');

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const [sql] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/orchestrator_version\s*=\s*'v2'/);
  });

  it('B-08: DB 抛异常 → 500 + body 仅含 error 字段，不暴露内部信息', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('connection refused: pg internal'));

    const res = await request(app).get('/api/brain/orchestrator/relay-runs/summary');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
    // 不暴露内部 err.message
    expect(JSON.stringify(res.body)).not.toMatch(/pg internal|connection refused|stack/);
  });

  it('separates trust counts and computes SLO from native trusted rows only', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { phase: 'done', record_trust_status: 'trusted', count: '3' },
        { phase: 'failed', record_trust_status: 'trusted', count: '1' },
        { phase: 'done', record_trust_status: 'reconstructed', count: '20' },
        { phase: 'failed', record_trust_status: 'untrusted', count: '5' },
        { phase: 'generate', record_trust_status: 'trusted', count: '7' },
      ],
    }).mockResolvedValueOnce({
      rows: [{ trusted_total: '4', trusted_done: '3' }],
    });

    const res = await request(app).get('/api/brain/orchestrator/relay-runs/summary');

    expect(res.status).toBe(200);
    expect(res.body.phases).toMatchObject({ done: 23, failed: 6 });
    expect(res.body.trust).toEqual({
      trusted: 11,
      reconstructed: 20,
      untrusted: 5,
    });
    expect(res.body.slo).toEqual({
      trusted_total: 4,
      trusted_done: 3,
      trusted_success_rate: 0.75,
    });
  });

  it('returns null trusted success rate when no native trusted rows exist', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { phase: 'done', record_trust_status: 'reconstructed', count: '2' },
      ],
    }).mockResolvedValueOnce({
      rows: [{ trusted_total: '0', trusted_done: '0' }],
    });

    const res = await request(app).get('/api/brain/orchestrator/relay-runs/summary');

    expect(res.body.slo.trusted_total).toBe(0);
    expect(res.body.slo.trusted_success_rate).toBeNull();
  });

  it('derives SLO from the latest trusted run per task, excluding active work', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ trusted_total: '2', trusted_done: '1' }],
      });

    const res = await request(app).get('/api/brain/orchestrator/relay-runs/summary');

    expect(res.body.slo).toEqual({
      trusted_total: 2,
      trusted_done: 1,
      trusted_success_rate: 0.5,
    });
    const [sql] = mockPool.query.mock.calls[1];
    expect(sql).toMatch(/DISTINCT ON\s*\(current_task_id\)/);
    expect(sql).toMatch(/ORDER BY current_task_id,\s*started_at DESC,\s*id DESC/);
  });
});
