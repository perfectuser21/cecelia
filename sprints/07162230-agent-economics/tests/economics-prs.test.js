/**
 * [T2] economics-prs — 报表端点聚合正确 failing test
 *
 * sprint: 07162230-agent-economics
 * contract: B7, B8, B9, B13
 *
 * 铁律：
 * - 预置 fixture（3 个 task，已知 cost_usd），断言聚合正确
 * - 修复前 FAIL（端点不存在 → 404），修复后 PASS
 * - 超出 days 范围的 event 不出现在结果中
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- DB mock（hoisted）----
const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../packages/brain/src/db.js', () => ({ default: mockPool }));

// fixture 数据
// 3 个 task，7 天内有数据
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

// 预期 summary（精度 ±0.0001）
const EXPECTED_TOTAL_COST = 0.035 + 0.012 + 0.009; // = 0.056
const EXPECTED_TOTAL_ATTEMPTS = 2 + 1 + 3; // = 6

async function buildApp() {
  vi.resetModules();
  // [T2 FAIL POINT] 修复前：economics.js 不存在，import 报错 → 端点 404
  const { default: router } = await import(
    '../../packages/brain/src/routes/economics.js'
  );
  const a = express();
  a.use(express.json());
  a.use('/api/brain/economics', router);
  return a;
}

describe('[T2] GET /api/brain/economics/prs 报表端点（B7-B9）', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: FIXTURE_PRS });
    app = await buildApp();
  });

  it('B7: 返回 prs 数组 + summary，含必填字段', async () => {
    const res = await request(app)
      .get('/api/brain/economics/prs?days=7')
      .expect(200);

    expect(res.headers['content-type']).toMatch(/application\/json/);

    // prs 数组
    expect(res.body).toHaveProperty('prs');
    expect(Array.isArray(res.body.prs)).toBe(true);
    expect(res.body.prs).toHaveLength(3);

    // 每项必填字段
    const first = res.body.prs[0];
    expect(first).toHaveProperty('task_id');
    expect(first).toHaveProperty('total_cost_usd');
    expect(first).toHaveProperty('attempt_count');
    expect(first).toHaveProperty('events_count');
    expect(first).toHaveProperty('duration_ms');

    // summary 对象
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('total_cost_usd');
    expect(res.body.summary).toHaveProperty('avg_cost_per_pr');
    expect(res.body.summary).toHaveProperty('total_attempts');
  });

  it('B7: summary.total_cost_usd 等于各 task cost 之和（精度 ±0.0001）', async () => {
    const res = await request(app)
      .get('/api/brain/economics/prs?days=30')
      .expect(200);

    const totalCost = Number(res.body.summary.total_cost_usd);
    expect(
      Math.abs(totalCost - EXPECTED_TOTAL_COST),
      `total_cost_usd ${totalCost} 与期望 ${EXPECTED_TOTAL_COST} 差距超 0.0001`
    ).toBeLessThan(0.0001);
  });

  it('B7: summary.total_attempts 等于所有 attempt 总和', async () => {
    const res = await request(app)
      .get('/api/brain/economics/prs?days=30')
      .expect(200);

    expect(Number(res.body.summary.total_attempts)).toBe(EXPECTED_TOTAL_ATTEMPTS);
  });

  it('B8: 超出 days 范围的 event 不出现（SQL 使用 days 过滤）', async () => {
    // 验证 SQL 中含 days 相关参数传入（通过 mockPool.query 断言）
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 模拟 7 天内无数据

    await request(app)
      .get('/api/brain/economics/prs?days=7')
      .expect(200);

    // 验证 query 被调用，且参数含 days 值（7）或动态计算的 interval
    expect(mockPool.query).toHaveBeenCalled();
    const [sql, params] = mockPool.query.mock.calls[0];
    // SQL 应含时间过滤（interval 或 timestamp 比较）
    const hasDaysFilter =
      /interval|NOW\(\)|CURRENT_TIMESTAMP|EXTRACT|ts_end|created_at/i.test(sql);
    expect(hasDaysFilter, 'SQL 应包含时间范围过滤').toBe(true);
    // 参数中应含 days 值（7）
    expect(params).toContain(7);
  });

  it('B9: 查无记录时返回空数组 + summary 均为 0', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/brain/economics/prs?days=7')
      .expect(200);

    expect(res.body.prs).toEqual([]);
    expect(Number(res.body.summary.total_cost_usd)).toBe(0);
    expect(Number(res.body.summary.total_attempts)).toBe(0);
    expect(Number(res.body.summary.avg_cost_per_pr)).toBe(0);
  });

  it('B13: days 参数缺省时使用合理默认值（不 500）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/brain/economics/prs')
      .expect((r) => {
        // 200 或 400（missing param）均可，但不能 404 或 500
        expect([200, 400]).toContain(r.status);
      });
  });

  it('B7: avg_cost_per_pr = total_cost_usd / pr 数量（精度 ±0.0001）', async () => {
    const res = await request(app)
      .get('/api/brain/economics/prs?days=30')
      .expect(200);

    const prs = res.body.prs;
    const summary = res.body.summary;
    if (prs.length > 0) {
      const expectedAvg = EXPECTED_TOTAL_COST / prs.length;
      expect(
        Math.abs(Number(summary.avg_cost_per_pr) - expectedAvg)
      ).toBeLessThan(0.0001);
    }
  });
});
