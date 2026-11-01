/** relay-runs HTTP 回归：生产路由加显式数据库边界，不探测共享 Brain 或连接真实数据库。 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { pool } = vi.hoisted(() => ({ pool: { query: vi.fn() } }));
// 命中 Brain 的真实 db.js 模块，所有路由查询均进入本测试边界。
vi.mock('../../../brain/src/db.js', () => ({ default: pool }));

const V2_RUN = {
  id: 'aaaabbbb-1111-4222-8333-444455556666',
  initiative_id: 'bbbbcccc-1111-4222-8333-444455556666',
  phase: 'A_planning',
  orchestrator_heartbeat_at: null,
  orchestrator_host: null,
  pr_url: null,
  started_at: '2026-07-04T10:00:00.000Z',
  deadline_at: null,
};
let app: express.Express;
beforeAll(async () => {
  const { default: router } = await import('../../../brain/src/routes/initiatives.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain/orchestrator', router);
});
beforeEach(() => pool.query.mockReset());

describe('relay-runs 隔离HTTP回归', () => {
  it('生产路由返回v2运行数组及id、initiative_id、phase、started_at必填字段', async () => {
    pool.query.mockResolvedValueOnce({ rows: [V2_RUN] });
    const response = await request(app).get('/api/brain/orchestrator/relay-runs').expect(200);
    expect(response.body).toEqual([V2_RUN]);
    for (const key of ['id', 'initiative_id', 'phase', 'started_at'])
      expect(response.body[0]).toHaveProperty(key, V2_RUN[key as keyof typeof V2_RUN]);
    expect(pool.query).toHaveBeenCalledOnce();
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/orchestrator_version\s*=\s*'v2'/);
    expect(sql).toMatch(/started_at\s+DESC/i);
    expect(params).toEqual([20]);
  });
  it('数据库没有运行记录时返回200和空数组', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const response = await request(app).get('/api/brain/orchestrator/relay-runs').expect(200);
    expect(response.body).toEqual([]);
  });
  it('数据库查询异常返回500，不能用空数组或成功响应掩盖失败', async () => {
    pool.query.mockRejectedValueOnce(new Error('isolated fixture query failed'));
    const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(app).get('/api/brain/orchestrator/relay-runs').expect(500);
      expect(response.body).toEqual({ error: 'internal server error' });
    } finally { logging.mockRestore(); }
  });
  it('非法limit在数据库边界前被拒绝', async () => {
    const response = await request(app).get('/api/brain/orchestrator/relay-runs?limit=invalid').expect(400);
    expect(response.body.error).toBeTruthy();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
