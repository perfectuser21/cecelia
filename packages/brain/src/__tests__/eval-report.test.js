import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../skill-eval-validator.js', () => ({
  validateZipBuffer: vi.fn(), computeZipHash: vi.fn(), checkZipDuplication: vi.fn(),
  checkSlotAvailable: vi.fn(), getEvalQueuePosition: vi.fn(),
}));
import router from '../routes/eval.js';
import fixture from '../__fixtures__/daily-report-cs.report.json';

const app = express(); app.use(express.json()); app.use('/api/skill-eval', router);

beforeEach(() => mockPool.query.mockReset());

describe('GET /api/skill-eval/report/:task_id', () => {
  it('有 report_data → 200 text/html 含6维度报告内容', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ report_data: fixture }] });
    const res = await request(app).get('/api/skill-eval/report/abc');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('功能地图'); expect(res.text).toContain('依赖审计'); expect(res.text).toContain('输出可验证性');
    expect(res.text).toContain('dimcard');
  });
  it('?format=json → 原始 report-data', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ report_data: fixture }] });
    const res = await request(app).get('/api/skill-eval/report/abc?format=json');
    expect(res.status).toBe(200);
    expect(res.body.skill.name).toBe('daily-report-cs');
  });
  it('无 report_data → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ report_data: null }] });
    const res = await request(app).get('/api/skill-eval/report/abc');
    expect(res.status).toBe(404);
  });
  it('task 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/skill-eval/report/nope');
    expect(res.status).toBe(404);
  });
});
