import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../handoffs.js');
  const express = (await import('express')).default;
  const app = express();
  app.use('/api/brain/handoffs', router);
  return app;
}
const req = async () => (await import('supertest')).default;

const handoffRow = (over = {}) => ({
  id: 'task-1',
  title: 'db 行 title',
  handoff: {
    task_id: 'task-1',
    title: '交接单 title',
    verdict: 'PASS',
    journey_id: 'j-01',
    created_at: '2026-07-07T00:00:00.000Z',
    next_steps: ['下一步 A'],
    artifacts: { pr_urls: ['https://github.com/x/pr/1'], sprint_dir: null, branch: null, docs: [] },
    ...over,
  },
});

describe('GET /api/brain/handoffs — warroom 接力史（relay-baton4 item1）', () => {
  beforeEach(() => mockQuery.mockReset());

  it('返回摘要字段（pr_urls 从 artifacts 提取），默认 limit=20', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [handoffRow()] });
    const res = await (await req())(await makeApp()).get('/api/brain/handoffs');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const h = res.body.handoffs[0];
    expect(h.task_id).toBe('task-1');
    expect(h.title).toBe('交接单 title');
    expect(h.verdict).toBe('PASS');
    expect(h.journey_id).toBe('j-01');
    expect(h.next_steps).toEqual(['下一步 A']);
    expect(h.pr_urls).toEqual(['https://github.com/x/pr/1']);
    expect(mockQuery.mock.calls[0][1]).toContain(20);
  });

  it('SQL 按 handoff.created_at 倒序 + 只取带 handoff 的 tasks', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await (await req())(await makeApp()).get('/api/brain/handoffs');
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/result\s*\?\s*'handoff'/);
    expect(sql.toLowerCase()).toContain("order by (result->'handoff'->>'created_at') desc");
  });

  it('journey_id 过滤：handoff.journey_id 或 payload.journey_id 命中（参数化）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await (await req())(await makeApp()).get('/api/brain/handoffs?journey_id=j-05');
    const sql = mockQuery.mock.calls[0][0];
    const params = mockQuery.mock.calls[0][1];
    expect(sql).toContain("result->'handoff'->>'journey_id'");
    expect(sql).toContain("payload->>'journey_id'");
    expect(params).toContain('j-05');
  });

  it('limit clamp：>100 → 100；非法 → 20', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await makeApp();
    await (await req())(app).get('/api/brain/handoffs?limit=500');
    expect(mockQuery.mock.calls[0][1]).toContain(100);
    await (await req())(app).get('/api/brain/handoffs?limit=abc');
    expect(mockQuery.mock.calls[1][1]).toContain(20);
  });

  it('handoff 字段缺失时安全回退（title 回退 tasks.title，数组回退 []）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-2', title: 'db 行 title', handoff: { task_id: 'task-2' } }],
    });
    const res = await (await req())(await makeApp()).get('/api/brain/handoffs');
    const h = res.body.handoffs[0];
    expect(h.title).toBe('db 行 title');
    expect(h.verdict).toBeNull();
    expect(h.next_steps).toEqual([]);
    expect(h.pr_urls).toEqual([]);
  });

  it('空库返回 { handoffs: [], total: 0 }；DB 错误返回 500', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const app = await makeApp();
    const ok = await (await req())(app).get('/api/brain/handoffs');
    expect(ok.body).toEqual({ handoffs: [], total: 0 });
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const bad = await (await req())(app).get('/api/brain/handoffs');
    expect(bad.status).toBe(500);
  });
});
