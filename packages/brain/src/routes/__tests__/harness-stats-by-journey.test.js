import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../harness.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain/harness', router);
  return app;
}
const req = async () => (await import('supertest')).default;

describe('GET /harness/stats?by=journey — 战况室数据层（P2）', () => {
  beforeEach(() => mockQuery.mockReset());

  it('by=journey 返回每条 Line 的 run 数 + 成功率 + 最近战况', async () => {
    // 单条聚合查询：每 journey 一行
    mockQuery.mockResolvedValueOnce({
      rows: [
        { journey_id: 'j-04', journey_name: 'Line 04 客户私域 AI 接管', runs: '5', done: '4', failed: '1', last_run_at: '2026-07-05T00:00:00Z', last_failure: null },
        { journey_id: 'j-05', journey_name: 'Line 05 视频剪辑', runs: '2', done: '1', failed: '1', last_run_at: '2026-07-04T00:00:00Z', last_failure: '账号 401' },
      ],
    });
    const res = await (await req())(await makeApp()).get('/api/brain/harness/stats?by=journey&days=30');
    expect(res.status).toBe(200);
    expect(res.body.by).toBe('journey');
    expect(res.body.period_days).toBe(30);
    expect(Array.isArray(res.body.journeys)).toBe(true);
    const l04 = res.body.journeys.find(j => j.journey_id === 'j-04');
    expect(l04.runs).toBe(5);
    expect(l04.done).toBe(4);
    expect(l04.failed).toBe(1);
    // 成功率 = done/(done+failed) = 4/5 = 0.8
    expect(l04.success_rate).toBe(0.8);
  });

  it('by=journey 的 SQL 过滤 smoke-* + 无 journey 孤儿 + days 参数', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await (await req())(await makeApp()).get('/api/brain/harness/stats?by=journey&days=7');
    const sql = mockQuery.mock.calls[0][0];
    const params = mockQuery.mock.calls[0][1] || [];
    // 排除无 journey 孤儿
    expect(sql).toMatch(/journey_id\s+IS\s+NOT\s+NULL/i);
    // 过滤 smoke-* 测试任务
    expect(sql.toLowerCase()).toContain('smoke-%');
    // 按 journey 聚合
    expect(sql.toLowerCase()).toContain('group by');
    // days 走参数化（防注入）
    expect(params).toContain(7);
  });

  it('days 非法（非数字/越界）回退默认 30', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await (await req())(await makeApp()).get('/api/brain/harness/stats?by=journey&days=abc');
    expect(mockQuery.mock.calls[0][1]).toContain(30);
  });

  it('无 by 参数保持原全局响应（向后兼容）', async () => {
    // 原 handler 4 次查询：total / done / gan / duration
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '10' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ done: '6' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_rounds: '2.5' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_ms: '1000' }] });
    const res = await (await req())(await makeApp()).get('/api/brain/harness/stats');
    expect(res.status).toBe(200);
    expect(res.body.total_pipelines).toBe(10);
    expect(res.body.completion_rate).toBe(0.6);
    expect(res.body.by).toBeUndefined();
  });
});
