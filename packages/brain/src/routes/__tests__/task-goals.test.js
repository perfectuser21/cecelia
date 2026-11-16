import { beforeEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query } }));
// 公司KR度量保护独立验证；此处隔离其数据库读取。
vi.mock('../../lib/company-kr-metrics.js', () => ({ assertCompanyPatch: vi.fn(async () => {}) }));
import router from '../task-goals.js';
const ID = 'a0000000-0000-4000-8000-000000000001';
function app() { const a = express(); a.use(express.json()); a.use('/goals', router); return a; }
beforeEach(() => vi.resetAllMocks());
describe('task-goals HTTP', () => {
  it('audit实际查询done并转换数值、空进度与汇总偏差', async () => {
    query.mockResolvedValueOnce({ rows: [
      { id: ID, title: 'KR', type: 'area_kr', status: 'active', stated_progress: '80', actual_progress: '50', total_initiatives: '4', completed_initiatives: '2' },
      { id: 'empty', title: 'Empty', type: 'area_kr', status: 'active', stated_progress: null, actual_progress: null, total_initiatives: '0', completed_initiatives: '0' },
    ] });
    const r = await request(app()).get('/goals/audit');
    expect(r.status).toBe(200);
    const sql = query.mock.calls[0][0];
    expect(sql.match(/FILTER \(WHERE oi.status = 'done'\)/g)).toHaveLength(2);
    expect(sql).not.toMatch(/oi.status = 'completed'/);
    expect(r.body.goals[0]).toMatchObject({ stated_progress: 80, actual_progress: 50, total_initiatives: 4, completed_initiatives: 2, discrepancy: 30 });
    expect(r.body.goals[1]).toMatchObject({ stated_progress: 0, actual_progress: null, discrepancy: null });
    expect(r.body.summary).toEqual({ total_goals: 2, overstated: 1, no_initiatives: 1, accurate: 0 });
  });
  it('列表parent/status和分页参数传入key_results查询', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: ID }] });
    const r = await request(app()).get(`/goals?parent_id=${ID}&status=active&limit=4&offset=2`);
    expect(r.status).toBe(200); expect(r.body).toEqual([{ id: ID }]);
    expect(query.mock.calls[0][0]).toMatch(/FROM key_results WHERE status = \$1 AND objective_id = \$2/);
    expect(query.mock.calls[0][1]).toEqual(['active', ID, 4, 2]);
  });
  it('GET非法ID零SQL；合法不存在先查objective再KR返回404', async () => {
    expect((await request(app()).get('/goals/bad')).status).toBe(400); expect(query).not.toHaveBeenCalled();
    query.mockResolvedValue({ rows: [] });
    expect((await request(app()).get(`/goals/${ID}`)).status).toBe(404);
    expect(query.mock.calls[0][0]).toContain('FROM objectives WHERE id = $1');
    expect(query.mock.calls[1][0]).toContain('FROM key_results WHERE id = $1');
    expect(query.mock.calls.map(c => c[1])).toEqual([[ID], [ID]]);
  });
  it('PATCH未命中objective才回落KR，并保留metadata合并参数', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: ID, status: 'done' }] });
    const r = await request(app()).patch(`/goals/${ID}`).send({ status: 'done', metadata: { owned: true } });
    expect(r.status).toBe(200); expect(r.body.status).toBe('done');
    expect(query.mock.calls[0][0]).toContain('UPDATE objectives'); expect(query.mock.calls[1][0]).toContain('UPDATE key_results');
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toContain("metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb");
      expect(params).toEqual(['done', '{"owned":true}', ID]);
    }
  });
});
