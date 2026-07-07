import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('GET /api/brain/sentinel/health — 调度哨兵灯（relay-baton4 item1）', () => {
  beforeEach(() => mockQuery.mockReset());

  it('全部 job 新鲜且 ok → healthy=true，输出 name/ok/age_seconds/at', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [jobRow('arch-review'), jobRow('daily-backup'), expectedRow(2)],
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
    mockQuery.mockResolvedValueOnce({ rows: [jobRow('arch-review'), expectedRow(5)] });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.healthy).toBe(false);
  });

  it('某 job age_seconds 超 1800 → healthy=false', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [jobRow('arch-review', { age_seconds: 7200 }), expectedRow(1)],
    });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.healthy).toBe(false);
  });

  it('某 job ok=false（失败/超时）→ healthy=false', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: 'scheduler_job_last_run:strategy-trigger', value_json: { at: 'x', ok: false, error: 'boom' }, age_seconds: 30 },
        expectedRow(1),
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
