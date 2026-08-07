import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const queryMock = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => queryMock(...a) } }));

const { default: journeysRouter } = await import('../routes/journeys.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', journeysRouter);
  return app;
}

beforeEach(() => { queryMock.mockReset(); });

describe('GET /api/brain/issues（T6）', () => {
  it('无参：默认 limit 20，返回 {issues:[...]}', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'i1', title: 'x', priority: 'P1', status: 'In progress' }] });
    const res = await request(makeApp()).get('/api/brain/issues');
    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/FROM issues/);
    expect(sql).toMatch(/ORDER BY priority ASC, created_at DESC/);
    expect(params[params.length - 1]).toBe(20);
  });

  it('status + journey_id 过滤进 WHERE，limit 钳制到 100', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).get('/api/brain/issues?status=Closed&journey_id=j-1&limit=999');
    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/status=\$1/);
    expect(sql).toMatch(/journey_id=\$2/);
    expect(params).toEqual(['Closed', 'j-1', 100]);
  });

  it("status=open 特判为未关闭过滤（NOT IN 形状，非 status=$1）——库里词表是 Notion 风格，不存在 'open' 精确值", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).get('/api/brain/issues?status=open&limit=8');
    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0];
    // 必须是大小写不敏感的 NOT IN 关闭词表，而不是精确匹配 status=$1
    expect(sql).not.toMatch(/status=\$1/);
    expect(sql).toMatch(/LOWER\(status\) NOT IN \('closed','resolved','done'\)/);
    // 'open' 不进参数（只剩 limit）
    expect(params).toEqual([8]);
  });

  it('status=open 大小写不敏感（Open 同样走 NOT IN），且可与 journey_id 组合', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).get('/api/brain/issues?status=Open&journey_id=j-9');
    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/LOWER\(status\) NOT IN/);
    expect(sql).toMatch(/journey_id=\$1/);
    expect(params).toEqual(['j-9', 20]);
  });

  it('查询抛错 → 500 + error', async () => {
    queryMock.mockRejectedValue(new Error('boom'));
    const res = await request(makeApp()).get('/api/brain/issues');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('PATCH /api/brain/issues/:id（ccf85841 关闭端点）', () => {
  it('更新 status=Closed → 返回更新后的行', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'ccf85841-c005-485a-9143-c7fb68bc66a5', status: 'Closed', title: 'x' }] });
    const res = await request(makeApp())
      .patch('/api/brain/issues/ccf85841-c005-485a-9143-c7fb68bc66a5')
      .send({ status: 'Closed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Closed');
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/UPDATE issues SET/);
    expect(sql).toMatch(/status=\$1/);
    expect(params).toContain('Closed');
  });

  it('无可更新字段 → 400', async () => {
    const res = await request(makeApp())
      .patch('/api/brain/issues/ccf85841-c005-485a-9143-c7fb68bc66a5')
      .send({ unknown_field: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no patchable fields/);
  });

  it('issue 不存在 → 404', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await request(makeApp())
      .patch('/api/brain/issues/no-such-id')
      .send({ status: 'Closed' });
    expect(res.status).toBe(404);
  });

  it('可同时更新多字段（status + pr_url）', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'x', status: 'Closed', pr_url: 'https://github.com/x/1' }] });
    const res = await request(makeApp())
      .patch('/api/brain/issues/x')
      .send({ status: 'Closed', pr_url: 'https://github.com/x/1' });
    expect(res.status).toBe(200);
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toMatch(/pr_url=\$2/);
  });
});
