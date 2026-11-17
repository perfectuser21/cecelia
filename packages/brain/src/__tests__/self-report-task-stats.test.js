import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const boundary = vi.hoisted(() => ({ query: vi.fn(), llm: vi.fn(), forbidden: [] }));
vi.mock('../db.js', () => ({ default: { query: boundary.query } }));
vi.mock('../llm-caller.js', () => ({ callLLM: boundary.llm }));
import router from '../routes/self-reports.js';

let server;
beforeEach(async () => {
  boundary.query.mockReset();
  boundary.llm.mockReset();
  boundary.forbidden.length = 0;
  vi.stubGlobal('fetch', () => { boundary.forbidden.push('fetch'); throw Error('外网禁止'); });
  const app = express();
  app.use('/api/brain/self-reports', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
});
afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  vi.unstubAllGlobals();
  expect(boundary.forbidden).toEqual([]);
});

describe('自述采集已退役，历史只读保留', () => {
  it('真实 HTTP POST 返回 410，数据库和模型均无副作用', async () => {
    boundary.query.mockRejectedValue(Error('禁止数据库访问'));
    boundary.llm.mockRejectedValue(Error('禁止模型访问'));
    const res = await request(server).post('/api/brain/self-reports/collect');
    expect(res.status).toBe(410);
    expect(res.body).toEqual({ error: 'self_report_collection_retired', message: 'Brain 自述采集已停用，历史记录仍可查询。' });
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.llm).not.toHaveBeenCalled();
  });

  it.each([['', 20], ['?limit=3', 3], ['?limit=200', 100]])('真实 HTTP GET%s 仍查询原历史表', async (suffix, limit) => {
    const records = [{ id: 'historical-report', top_desire: '历史记录', self_rating: 5 }];
    boundary.query.mockResolvedValue({ rows: records });
    const res = await request(server).get('/api/brain/self-reports' + suffix);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ records, count: 1 });
    expect(boundary.query).toHaveBeenCalledTimes(1);
    expect(boundary.query).toHaveBeenCalledWith(expect.stringContaining('FROM self_reports'), [limit]);
    expect(boundary.query.mock.calls[0][0]).toContain('ORDER BY created_at DESC');
    expect(boundary.llm).not.toHaveBeenCalled();
  });

  it('历史查询失败仍返回 500，不启动生成或写入', async () => {
    boundary.query.mockRejectedValue(Error('历史查询失败'));
    const res = await request(server).get('/api/brain/self-reports');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: '历史查询失败' });
    expect(boundary.query).toHaveBeenCalledTimes(1);
    expect(boundary.llm).not.toHaveBeenCalled();
  });
});
