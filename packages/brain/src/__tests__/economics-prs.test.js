/**
 * [T2] economics-prs — 报表端点聚合正确 failing test
 *
 * sprint: 07162230-agent-economics
 * contract: B7, B8, B9, B13
 *
 * 铁律：
 * - 预置 fixture（3 个 task，已知 cost_usd），断言聚合正确
 * - 修复前 FAIL（economics.js 不存在 → import 错误），修复后 PASS
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- DB mock（hoisted）----
const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPool }));

// fixture 数据（3 个 task，7 天内有数据）
const FIXTURE_PRS = [
  {
    task_id: 'task-aaaaaaaa-0001',
    pr_url: 'https://github.com/org/repo/pull/101',
    total_cost_usd: '0.0350',
    attempt_count: '2',
    refire_count: '1',
    duration_ms: '120000',
    events_count: '4',
  },
  {
    task_id: 'task-bbbbbbbb-0002',
    pr_url: 'https://github.com/org/repo/pull/102',
    total_cost_usd: '0.0120',
    attempt_count: '1',
    refire_count: '0',
    duration_ms: '60000',
    events_count: '2',
  },
  {
    task_id: 'task-cccccccc-0003',
    pr_url: null,
    total_cost_usd: '0.0090',
    attempt_count: '3',
    refire_count: '2',
    duration_ms: '180000',
    events_count: '6',
  },
];

const EXPECTED_TOTAL_COST = 0.035 + 0.012 + 0.009; // 0.056
const EXPECTED_TOTAL_ATTEMPTS = 2 + 1 + 3; // 6

let app;

async function buildApp() {
  vi.resetModules();
  // [T2 FAIL POINT] 修复前：economics.js 不存在 → import 失败 → 端点不存在 → 404
  const { default: router } = await import('../routes/economics.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/economics', router);
  return a;
}

describe('[T2] GET /api/brain/economics/prs 报表端点', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: FIXTURE_PRS });
    app = await buildApp();
  });

  it('B7: 返回 HTTP 200 + prs 数组 + summary 对象', async () => {
    const res = await request(app)
      .get('/api/brain/economics/prs?days=7')
      .expect(200);

    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('prs');
    expect(Array.isArray(res.body.prs)).toBe(true);
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('total_cost_usd');
    expect(res.body.summary).toHaveProperty('avg_cost_per_pr');
    expect(res.body.summary).toHaveProperty('total_attempts');
  });

  it('B7: prs 每项含 task_id, total_cost_usd, attempt_count, events_count, duration_ms', async () => {
    const res = await request(app)
      .get('/api/brain/economics/prs?days=7')
      .expect(200);

    expect(res.body.prs).toHaveLength(3);
    const item = res.body.prs[0];
    expect(item).toHaveProperty('task_id');
    expect(item).toHaveProperty('total_cost_usd');
    expect(item).toHaveProperty('attempt_count');
    expect(item).toHaveProperty('events_count');
    expect(item).toHaveProperty('duration_ms');
  });

  it('B7: summary.total_cost_usd = fixture 各 task cost 之和（±0.0001）', async () => {
    const res = await request(app)
      .get('/api/brain/economics/prs?days=30')
      .expect(200);

    const totalCost = Number(res.body.summary.total_cost_usd);
    expect(
      Math.abs(totalCost - EXPECTED_TOTAL_COST)
    ).toBeLessThan(0.0001);
  });

  it('B7: summary.total_attempts = fixture 所有 attempt 总和', async () => {
    const res = await request(app)
      .get('/api/brain/economics/prs?days=30')
      .expect(200);

    expect(Number(res.body.summary.total_attempts)).toBe(EXPECTED_TOTAL_ATTEMPTS);
  });

  it('B7: avg_cost_per_pr = total_cost / pr 数量（±0.0001）', async () => {
    const res = await request(app)
      .get('/api/brain/economics/prs?days=30')
      .expect(200);

    const prs = res.body.prs;
    if (prs.length > 0) {
      const expectedAvg = EXPECTED_TOTAL_COST / prs.length;
      expect(
        Math.abs(Number(res.body.summary.avg_cost_per_pr) - expectedAvg)
      ).toBeLessThan(0.0001);
    }
  });

  it('B8: SQL 中含 days 范围过滤（time filter + days 参数）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get('/api/brain/economics/prs?days=7')
      .expect(200);

    expect(mockPool.query).toHaveBeenCalled();
    const [sql, params] = mockPool.query.mock.calls[0];

    // SQL 含时间过滤
    const hasTimeFilter =
      /interval|NOW\(\)|CURRENT_TIMESTAMP|EXTRACT|NOW\s*\(\s*\)/i.test(sql);
    expect(hasTimeFilter, 'SQL 须含时间范围过滤').toBe(true);

    // days 值须作为参数传入（避免 SQL 注入）
    expect(params).toContain(7);
  });

  it('B9: 无记录时返回 [] + summary 全为 0', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/brain/economics/prs?days=7')
      .expect(200);

    expect(res.body.prs).toEqual([]);
    expect(Number(res.body.summary.total_cost_usd)).toBe(0);
    expect(Number(res.body.summary.total_attempts)).toBe(0);
    expect(Number(res.body.summary.avg_cost_per_pr)).toBe(0);
  });

  it('B13: days 参数缺省时不 500（200 或 400 均可）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/brain/economics/prs');
    expect([200, 400]).toContain(res.status);
  });
});
