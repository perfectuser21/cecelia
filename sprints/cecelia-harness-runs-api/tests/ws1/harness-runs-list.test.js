import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db.js before importing router
const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../../packages/brain/src/db.js', () => ({ default: mockPool }));

let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../../../packages/brain/src/routes/harness.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

const SAMPLE_RUN = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  initiative_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  phase: 'done',
  journey_type: 'autonomous',
  journey_id: null,
  created_at: new Date('2026-05-31T10:00:00Z'),
  completed_at: new Date('2026-05-31T10:30:00Z'),
  deadline_at: new Date('2026-05-31T16:00:00Z'),
  failure_reason: null,
  cost_usd: 0.42,
};

describe('Brain API — GET /initiative-runs (列表) [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[BEHAVIOR] 无参数返回 HTTP 200，顶层 keys 精确等于 ["runs","total"]', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [SAMPLE_RUN] });

    const app = createApp();
    const res = await request(app).get('/initiative-runs');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['runs', 'total']);
  });

  it('[BEHAVIOR] total 等于 runs 数组实际长度', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [SAMPLE_RUN, { ...SAMPLE_RUN, id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }] });

    const app = createApp();
    const res = await request(app).get('/initiative-runs');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(res.body.runs.length);
    expect(res.body.total).toBe(2);
  });

  it('[BEHAVIOR] runs 每条含全部 10 个必须字段', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [SAMPLE_RUN] });

    const app = createApp();
    const res = await request(app).get('/initiative-runs');

    expect(res.status).toBe(200);
    const run = res.body.runs[0];
    const requiredFields = ['id', 'initiative_id', 'phase', 'journey_type', 'journey_id',
      'created_at', 'completed_at', 'deadline_at', 'failure_reason', 'cost_usd'];
    for (const f of requiredFields) {
      expect(run, `缺少字段 ${f}`).toHaveProperty(f);
    }
  });

  it('[BEHAVIOR] runs 每条不含禁用字段 contract_id/current_task_id/merged_task_ids', async () => {
    const runWithBanned = { ...SAMPLE_RUN, contract_id: 'xxx', current_task_id: 'yyy', merged_task_ids: [] };
    mockPool.query.mockResolvedValueOnce({ rows: [runWithBanned] });

    const app = createApp();
    const res = await request(app).get('/initiative-runs');

    expect(res.status).toBe(200);
    const run = res.body.runs[0];
    expect(run).not.toHaveProperty('contract_id');
    expect(run).not.toHaveProperty('current_task_id');
    expect(run).not.toHaveProperty('merged_task_ids');
  });

  it('[BEHAVIOR] cost_usd 序列化为 number 或 null，不是字符串', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [SAMPLE_RUN] });

    const app = createApp();
    const res = await request(app).get('/initiative-runs');

    expect(res.status).toBe(200);
    const { cost_usd } = res.body.runs[0];
    expect(cost_usd === null || typeof cost_usd === 'number').toBe(true);
    expect(typeof cost_usd).not.toBe('string');
  });

  it('[BEHAVIOR] 空结果返回 HTTP 200, runs=[], total=0（不是 404）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    const res = await request(app).get('/initiative-runs?phase=nonexistent_phase_xyz');

    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('[BEHAVIOR] limit 非整数返回 HTTP 400，error 含 "invalid limit"', async () => {
    const app = createApp();
    const res = await request(app).get('/initiative-runs?limit=abc');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid limit/);
  });

  it('[BEHAVIOR] limit=0 返回 HTTP 400（<1 边界）', async () => {
    const app = createApp();
    const res = await request(app).get('/initiative-runs?limit=0');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid limit/);
  });

  it('[BEHAVIOR] limit=101 返回 HTTP 400（>100 边界）', async () => {
    const app = createApp();
    const res = await request(app).get('/initiative-runs?limit=101');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid limit/);
  });

  it('[BEHAVIOR] limit=100 成功返回 HTTP 200（边界合法值）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    const res = await request(app).get('/initiative-runs?limit=100');

    expect(res.status).toBe(200);
  });

  it('[BEHAVIOR] journey_id 非 UUID 返回 HTTP 400，error == "invalid journey_id: must be a UUID"', async () => {
    const app = createApp();
    const res = await request(app).get('/initiative-runs?journey_id=not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid journey_id: must be a UUID');
  });

  it('[BEHAVIOR] phase 为空字符串时返回 HTTP 200（忽略过滤）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    const res = await request(app).get('/initiative-runs?phase=');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
  });
});
