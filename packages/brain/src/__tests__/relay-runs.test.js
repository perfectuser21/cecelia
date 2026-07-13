/**
 * GET /api/brain/orchestrator/relay-runs 端点单元测试
 * TDD Red 阶段：路由未实现时全部 FAIL
 *
 * 覆盖：
 * 1. 正常返回 v2 runs（JSON 数组，含 PRD 必填字段）
 * 2. 只返回 orchestrator_version='v2' 的 run（v1 run 不出现）
 * 3. ?limit=N 参数生效
 * 4. 无 v2 run 时返回空数组 []
 * 5. DB 查询失败返回 HTTP 500 + JSON error 字段
 * 6. ?limit 非法值返回 400 + error 字段
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- mock pool（必须在 import 路由前 hoist）----
const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: mockPool }));

// 懒导入：路由文件尚未存在，导入会在路由实现后生效
let app;

async function buildApp() {
  // 动态 import 确保 mock 已注册
  const { default: router } = await import('../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  // 端点挂在 /api/brain/orchestrator 前缀下
  a.use('/api/brain/orchestrator', router);
  return a;
}

// 测试用样本数据（符合 PRD Response Schema）
const V2_RUN = {
  id: 'aaaabbbb-1111-2222-3333-444455556666',
  initiative_id: 'bbbbcccc-1111-2222-3333-444455556666',
  phase: 'A_planning',
  orchestrator_heartbeat_at: null,
  orchestrator_host: null,
  pr_url: null,
  started_at: '2026-07-04T10:00:00.000Z',
  deadline_at: '2026-07-04T16:00:00.000Z',
};

const V1_RUN = {
  id: 'ccccdddd-1111-2222-3333-444455556666',
  initiative_id: 'ddddeeee-1111-2222-3333-444455556666',
  phase: 'B_planning',
  orchestrator_heartbeat_at: null,
  orchestrator_host: null,
  pr_url: null,
  started_at: '2026-07-03T10:00:00.000Z',
  deadline_at: null,
};

describe('GET /api/brain/orchestrator/relay-runs', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('正常返回 v2 runs — HTTP 200 + JSON 数组含必填字段', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN] });

    const res = await request(app)
      .get('/api/brain/orchestrator/relay-runs')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    const item = res.body[0];
    // PRD 必填字段
    expect(item).toHaveProperty('id', V2_RUN.id);
    expect(item).toHaveProperty('initiative_id', V2_RUN.initiative_id);
    expect(item).toHaveProperty('phase', V2_RUN.phase);
    expect(item).toHaveProperty('started_at');
    expect(item).toHaveProperty('orchestrator_heartbeat_at');
    expect(item).toHaveProperty('orchestrator_host');
    expect(item).toHaveProperty('deadline_at');
  });

  it('SQL 查询必须含 orchestrator_version=v2 过滤条件（v1 run 不出现）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN] });

    await request(app)
      .get('/api/brain/orchestrator/relay-runs')
      .expect(200);

    expect(mockPool.query).toHaveBeenCalledOnce();
    const [sql] = mockPool.query.mock.calls[0];
    // 确认查询仅选 v2
    expect(sql).toMatch(/orchestrator_version\s*=\s*['"]?v2['"]?/i);
    // 确认排序
    expect(sql).toMatch(/started_at\s+DESC/i);
  });

  it('无 v2 run 时返回空数组 [] — HTTP 200', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/brain/orchestrator/relay-runs')
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('?limit=5 参数传给 SQL（最多返回 5 条）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN] });

    const res = await request(app)
      .get('/api/brain/orchestrator/relay-runs?limit=5')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    // 验证 SQL 使用了 limit 参数
    const [, params] = mockPool.query.mock.calls[0];
    expect(params).toContain(5);
  });

  it('?limit=abc 非法值返回 400 + error 字段', async () => {
    const res = await request(app)
      .get('/api/brain/orchestrator/relay-runs?limit=abc')
      .expect(400);

    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
  });

  it('?limit=0 返回 400 + error 字段（limit 必须 ≥ 1）', async () => {
    const res = await request(app)
      .get('/api/brain/orchestrator/relay-runs?limit=0')
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });

  it('DB 查询失败 → HTTP 500 + JSON error 字段，进程不崩', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app)
      .get('/api/brain/orchestrator/relay-runs')
      .expect(500);

    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
    // 确认不是裸 throw — 进程未崩（express 仍可响应）
    const res2 = await request(app).get('/api/brain/orchestrator/relay-runs?limit=abc').expect(400);
    expect(res2.body).toHaveProperty('error');
  });

  it('默认 limit=20（SQL 参数为 20）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get('/api/brain/orchestrator/relay-runs')
      .expect(200);

    const [, params] = mockPool.query.mock.calls[0];
    expect(params).toContain(20);
  });
});
