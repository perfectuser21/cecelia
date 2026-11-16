import { beforeEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query } }));
import router from '../captures.js';
function app() { const a = express(); a.use(express.json()); a.use('/captures', router); return a; }
beforeEach(() => vi.resetAllMocks());
describe('captures HTTP list and detail', () => {
  it('列表过滤参数、分页及计数数值转换', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'capture-1' }] })
      .mockResolvedValueOnce({ rows: [{ captured: '2', clarified: '3', done: '4', dropped: '1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '6' }] });
    const r = await request(app()).get('/captures?stage=captured&nature=issue&lane=AI&source=api&limit=7&offset=2');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ items: [{ id: 'capture-1' }], total: 6, counts_by_stage: { captured: 2, clarified: 3, done: 4, dropped: 1 } });
    expect(query.mock.calls[0][0]).toMatch(/status = \$1 AND nature = \$2 AND lane = \$3 AND source = \$4/);
    expect(query.mock.calls[0][1]).toEqual(['captured', 'issue', 'AI', 'api', 7, 2]);
    expect(query.mock.calls[2][1]).toEqual(['captured', 'issue', 'AI', 'api']);
  });
  it('详情拼接atoms，仅为完整归位目标生成backlink', async () => {
    const atoms = [{ id: 'a', target_type: 'issue', routed_to_table: 'issues', routed_to_id: 'i' }, { id: 'b', target_type: 'note', routed_to_table: null, routed_to_id: null }];
    query.mockResolvedValueOnce({ rows: [{ id: 'capture-1', content: 'owned content' }] }).mockResolvedValueOnce({ rows: atoms });
    const r = await request(app()).get('/captures/capture-1');
    expect(r.status).toBe(200); expect(r.body.atoms).toEqual(atoms);
    expect(r.body.backlinks).toEqual([{ table: 'issues', id: 'i', summary: 'issue → issues' }]);
    expect(query.mock.calls[0][1]).toEqual(['capture-1']); expect(query.mock.calls[1][1]).toEqual(['capture-1']);
  });
  it('不存在详情返回404且不再查询atoms', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const r = await request(app()).get('/captures/missing');
    expect(r.status).toBe(404); expect(r.body.error).toBe('capture not found'); expect(query).toHaveBeenCalledOnce();
  });
  it('真实POST校验拒绝空内容且不落库', async () => {
    const r = await request(app()).post('/captures').send({ source: 'api', content: '  ' });
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/content is required/); expect(query).not.toHaveBeenCalled();
  });
});
