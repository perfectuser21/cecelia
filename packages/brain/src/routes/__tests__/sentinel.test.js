import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../sentinel.js');
  const express = (await import('express')).default;
  const app = express();
  app.use('/api/brain/sentinel', router);
  return app;
}
const req = async () => (await import('supertest')).default;

const jobRow = (name, over = {}) => ({
  key: `scheduler_job_last_run:${name}`,
  value_json: { at: '2026-07-07T00:00:00.000Z', ok: true },
  age_seconds: 60,
  ...over,
});
const expectedRow = (count) => ({
  key: 'scheduler_jobs_expected',
  value_json: { count },
  age_seconds: 3600,
});

const declaredExpectedRow = (names, count = names.length) => ({
  ...expectedRow(count),
  value_json: { count, names },
});

describe('GET /api/brain/sentinel/health — 调度哨兵灯（relay-baton4 item1）', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    vi.resetModules();
  });

  it('全部 job 新鲜且 ok → healthy=true，输出 name/ok/age_seconds/at', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [jobRow('arch-review'), jobRow('daily-backup'), declaredExpectedRow(['arch-review', 'daily-backup'])],
    });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.status).toBe(200);
    expect(res.body.expected).toBe(2);
    expect(res.body.healthy).toBe(true);
    expect(res.body.jobs).toHaveLength(2);
    const j = res.body.jobs.find((x) => x.name === 'arch-review');
    expect(j.ok).toBe(true);
    expect(j.age_seconds).toBe(60);
    expect(j.at).toBe('2026-07-07T00:00:00.000Z');
  });

  it('job 数少于 expected → healthy=false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [jobRow('arch-review'), declaredExpectedRow(['arch-review', 'daily-backup', 'receipt-collector', 'machine-vitals', 'ops-collector'])] });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.healthy).toBe(false);
  });

  it('某 job age_seconds 超 1800 → healthy=false', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [jobRow('arch-review', { age_seconds: 7200 }), declaredExpectedRow(['arch-review'])],
    });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.healthy).toBe(false);
  });

  it('某 job ok=false（失败/超时）→ healthy=false', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: 'scheduler_job_last_run:strategy-trigger', value_json: { at: 'x', ok: false, error: 'boom' }, age_seconds: 30 },
        declaredExpectedRow(['strategy-trigger']),
      ],
    });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.healthy).toBe(false);
  });

  it('缺 scheduler_jobs_expected 键 → expected=null 且 healthy=false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [jobRow('arch-review')] });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.expected).toBeNull();
    expect(res.body.healthy).toBe(false);
  });

  it('仅判定现役声明，旧 guard-drill 失败且过期的心跳不污染健康或现役列表', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      jobRow('daily-backup'),
      jobRow('guard-drill', { value_json: { at: 'old-run', ok: false }, age_seconds: 86400 }),
      declaredExpectedRow(['daily-backup']),
    ] });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.status).toBe(200);
    expect(res.body.expected).toBe(1);
    expect(res.body.healthy).toBe(true);
    expect(res.body.jobs.map(job => job.name)).toEqual(['daily-backup']);
  });

  it('另一条新鲜历史心跳不能冒充缺失的现役任务', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [jobRow('guard-drill'), declaredExpectedRow(['daily-backup'])] });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.healthy).toBe(false);
    expect(res.body.jobs).toEqual([]);
  });

  it('现役失败即不健康，历史心跳再新鲜也不能补偿', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      jobRow('daily-backup', { value_json: { at: 'failed-run', ok: false }, age_seconds: 30 }),
      jobRow('guard-drill'), declaredExpectedRow(['daily-backup']),
    ] });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.healthy).toBe(false);
    expect(res.body.jobs.map(job => job.name)).toEqual(['daily-backup']);
  });

  it.each([
    { count: 2, names: ['daily-backup', 'daily-backup'] },
    { count: 1, names: ['daily-backup', 'arch-review'] },
    { count: 0, names: [] },
    { count: '1', names: ['daily-backup'] },
    { count: 1, names: [null] },
    { count: 1, names: [''] },
  ])('声明重复、缺项或格式不符不能假绿：%o', async declaration => {
    mockQuery.mockResolvedValueOnce({ rows: [
      jobRow('daily-backup'), jobRow('arch-review'),
      { key: 'scheduler_jobs_expected', value_json: declaration, age_seconds: 0 },
    ] });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.healthy).toBe(false);
  });

  it('旧 count-only 声明保留数字展示，但不能确认健康', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [jobRow('daily-backup'), expectedRow(1)] });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.expected).toBe(1);
    expect(res.body.healthy).toBe(false);
  });

  it('同一来源每分钟最多300次查询，超额返回429且不再访问数据库', async () => {
    vi.resetModules();
    mockQuery.mockResolvedValue({ rows: [] });
    const client = (await req())(await makeApp());
    for (let i = 0; i < 300; i++) {
      const response = await client.get('/api/brain/sentinel/health');
      expect(response.status).toBe(200);
    }
    const blocked = await client.get('/api/brain/sentinel/health');
    expect(blocked.status).toBe(429);
    expect(mockQuery).toHaveBeenCalledTimes(300);
  });

  it('age 由 SQL EXTRACT(EPOCH...) 计算（timestamp without time zone 不拿 JS 比）；DB 错误 → 500', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const app = await makeApp();
    await (await req())(app).get('/api/brain/sentinel/health');
    expect(mockQuery.mock.calls[0][0].toUpperCase()).toContain('EXTRACT(EPOCH FROM');
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const bad = await (await req())(app).get('/api/brain/sentinel/health');
    expect(bad.status).toBe(500);
  });
});


afterEach(() => {
  for (const [sql] of mockQuery.mock.calls) expect(sql.trim()).toMatch(/^SELECT\b/i);
});
