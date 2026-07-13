/**
 * GET /api/brain/orchestrator/relay-runs?task_id= 过滤 [BEHAVIOR]
 *
 * issue a638f840：harness-report TOTAL_COST fallback 需要按 task 查 relay runs
 * 求和 cost_usd，此前列表端点只支持 limit/phase/since。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: mockPool }));

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}

const TASK_ID = 'aaaabbbb-1111-2222-3333-444455556666';

describe('GET /relay-runs?task_id=', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  it('合法 uuid → 200 且 SQL 含 current_task_id 条件、参数透传', async () => {
    const app = await buildApp();
    const res = await request(app).get(`/api/brain/orchestrator/relay-runs?task_id=${TASK_ID}`);
    expect(res.status).toBe(200);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/current_task_id = \$/);
    expect(params).toContain(TASK_ID);
  });

  it('task_id 与 phase 组合过滤共存', async () => {
    const app = await buildApp();
    const res = await request(app).get(`/api/brain/orchestrator/relay-runs?task_id=${TASK_ID}&phase=evaluate`);
    expect(res.status).toBe(200);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/current_task_id = \$/);
    expect(sql).toMatch(/phase = \$/);
    expect(params).toContain(TASK_ID);
    expect(params).toContain('evaluate');
  });

  it('非法 task_id（非 uuid）→ 400', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/brain/orchestrator/relay-runs?task_id=not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('响应行含 current_task_id 字段（消费方按 task 求和 cost_usd 需要核对归属）', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'r1', current_task_id: TASK_ID, cost_usd: '7.38', phase: 'done' }],
    });
    const app = await buildApp();
    const res = await request(app).get(`/api/brain/orchestrator/relay-runs?task_id=${TASK_ID}`);
    expect(res.status).toBe(200);
    expect(res.body[0].current_task_id).toBe(TASK_ID);
  });

  it('不带 task_id 请求时 SQL 不含 current_task_id 条件（防未来重构恒加条件）', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/brain/orchestrator/relay-runs');
    expect(res.status).toBe(200);
    const [sql] = mockPool.query.mock.calls[0];
    expect(sql).not.toMatch(/current_task_id = \$/);
  });
});
