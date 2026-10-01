import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCompanyKrRouter } from '../company-key-results.js';

describe('公司KR真实HTTP入口', () => {
  it('GET公司列表保留raw precision与显式source，不依赖最近5个Objective', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: 'kr', title: '经营指标', unit: '%', metadata: { metric_mode: 'company_formula_v1', company_metric: { start: '0', current: '1.234', target: '5', ratio: 0.247 } }, custom_props: { company_notion: { page_id: 'page', goal_id: 'goal', area_ids: [] } }, updated_at: new Date('2026-10-01T00:00:00Z') }] })) };
    const app = express(); app.use(express.json()); app.use('/api/brain/okr', createCompanyKrRouter({ pool }));
    const response = await request(app).get('/api/brain/okr/company-key-results');
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ source_page_id: 'page', current_value: '1.234', progress_ratio: 0.247, source_area_ids: [] });
  });
  it('观察无证据与import无任务必须400且零写', async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const app = express(); app.use(express.json()); app.use('/api/brain/okr', createCompanyKrRouter({ pool }));
    expect((await request(app).post('/api/brain/okr/key-results/kr/observations').send({ current_value: 0 })).status).toBe(400);
    expect((await request(app).post('/api/brain/okr/company-key-results/import').send({})).status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
