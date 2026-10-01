import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const defaultPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: defaultPool }));
import { createCompanyKrRouter } from '../company-key-results.js';
import hierarchy from '../okr-hierarchy.js';
import taskGoals from '../task-goals.js';

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
  it('现有两个泛PATCH真实HTTP都不能清公司metadata或改Current', async () => {
    defaultPool.query.mockResolvedValue({ rows: [{ metadata: { metric_mode: 'company_formula_v1' }, custom_props: { company_notion: { page_id: 'source' } } }] });
    const app = express(); app.use(express.json()); app.use('/api/brain/okr', hierarchy); app.use('/api/brain/goals', taskGoals);
    for (const path of ['/api/brain/okr/key-results/kr', '/api/brain/goals/kr']) {
      for (const body of [{ metadata: null }, { metadata: { metric_mode: null } }, { current_value: 999 }]) {
        defaultPool.query.mockClear();
        expect((await request(app).patch(path).send(body)).status).toBe(409);
        expect(defaultPool.query.mock.calls.every(([sql]) => !sql.includes('UPDATE'))).toBe(true);
      }
    }
  });
  it('公司Objective来源映射也不能被泛PATCH抹掉', async () => {
    defaultPool.query.mockClear();
    defaultPool.query.mockResolvedValue({ rows: [{ metadata: { source_system: 'notion-company-okr' }, custom_props: { company_notion: { page_id: 'goal' } } }] });
    const app = express(); app.use(express.json()); app.use('/api/brain/okr', hierarchy);
    expect((await request(app).patch('/api/brain/okr/objectives/goal').send({ custom_props: { company_notion: null } })).status).toBe(409);
    expect(defaultPool.query.mock.calls.every(([sql]) => !sql.includes('UPDATE'))).toBe(true);
  });
});
