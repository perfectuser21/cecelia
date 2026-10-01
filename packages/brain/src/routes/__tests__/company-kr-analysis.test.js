import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCompanyAnalysisRouter } from '../company-kr-analysis.js';

function appFor(pool) {
  const app = express(); app.use(express.json()); app.use('/api/brain/okr', createCompanyAnalysisRouter(pool)); return app;
}
const endpoint = '/api/brain/okr/company-key-results/analysis';

function fixture(initial = { enabled: false, hour: 8 }) {
  let config = initial;
  const latest = { id: 'analysis-task', status: 'failed', error_message: '缺少经营证据', input: { version: 1 }, analysis: null };
  const query = vi.fn(async (sql, args) => {
    if (sql.startsWith('INSERT INTO working_memory')) { config = JSON.parse(args[1]); return { rows: [] }; }
    if (sql.includes('FROM working_memory')) return { rows: config ? [{ value_json: config }] : [] };
    if (sql.includes('FROM tasks')) return { rows: [latest] };
    throw new Error(`非预期SQL:${sql}`);
  });
  const pool = { query, connect: vi.fn() };
  return { app: appFor(pool), pool, latest, config: () => config };
}

describe('公司KR分析HTTP配置和启动', () => {
  it('GET显示默认停用配置及最近失败详情，不写状态', async () => {
    const f = fixture(null);
    const response = await request(f.app).get(endpoint);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, config: { enabled: false, hour: 8, timezone: 'Asia/Shanghai', agent: 'company-kr-analyst' }, latest: f.latest });
    expect(f.pool.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });

  it.each([
    {}, { enabled: 'true', hour: 8 }, { enabled: true, hour: -1 }, { enabled: true, hour: 24 },
    { enabled: true, hour: 8.5 }, { enabled: true, hour: 8, actor: 'forged' },
  ])('PATCH拒绝非法配置并零写：%j', async body => {
    const f = fixture();
    const response = await request(f.app).patch(endpoint).send(body);
    expect(response.status).toBe(400); expect(response.body.success).toBe(false);
    expect(f.pool.query).not.toHaveBeenCalled(); expect(f.pool.connect).not.toHaveBeenCalled();
  });

  it.each([0, 23])('PATCH接受边界小时%s并真实经过配置保存与回读', async hour => {
    const f = fixture();
    const response = await request(f.app).patch(endpoint).send({ enabled: true, hour });
    expect(response.status).toBe(200); expect(response.body.config).toMatchObject({ enabled: true, hour });
    expect(f.config()).toMatchObject({ enabled: true, hour, actor: 'notion-owner-workflow' });
    const writes = f.pool.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(writes).toHaveLength(1); expect(writes[0][0]).toContain('working_memory');
    expect(f.pool.connect).not.toHaveBeenCalled();
  });

  it.each([{}, { retry: true }])('POST在停用配置下不登记或打开事务：%j', async body => {
    const f = fixture();
    const response = await request(f.app).post(endpoint).send(body);
    expect(response.status).toBe(200); expect(response.body).toEqual({ skipped: true, reason: 'disabled' });
    expect(f.pool.connect).not.toHaveBeenCalled();
    expect(f.pool.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });

  it.each([{ retry: 'true' }, { retry: 1 }, { force: true }, { retry: false, task_id: 'forged' }])('POST拒绝扩权输入，零数据库请求：%j', async body => {
    const f = fixture();
    expect((await request(f.app).post(endpoint).send(body)).status).toBe(400);
    expect(f.pool.query).not.toHaveBeenCalled(); expect(f.pool.connect).not.toHaveBeenCalled();
  });

  it('启用但没有活动KR时提交只读检查事务，不插入任务', async () => {
    const query = vi.fn(async sql => sql.includes('FROM working_memory') ? { rows: [{ value_json: { enabled: true, hour: 8 } }] } : { rows: [] });
    const release = vi.fn(), pool = { query, connect: async () => ({ query, release }) };
    const response = await request(appFor(pool)).post(endpoint).send({});
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ skipped: true, reason: 'no_active_krs' });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
    expect(query.mock.calls.at(-1)[0]).toBe('COMMIT'); expect(release).toHaveBeenCalledOnce();
  });

  it('GET数据库故障返回可见500，不能冒充空成功', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('配置读取失败')) };
    const response = await request(appFor(pool)).get(endpoint);
    expect(response.status).toBe(500); expect(response.body).toEqual({ success: false, error: '配置读取失败' });
  });
});
