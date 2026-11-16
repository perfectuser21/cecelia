import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query } }));
beforeEach(() => vi.resetAllMocks());

// buildWhereClause 测试不需要 DB mock，单独 import
// computeLedgerStatus 纯函数测试见 lib/__tests__/eleven-elements-ledger.test.js

describe('features route — buildWhereClause', () => {
  it('returns empty clause when no filters', async () => {
    const { buildWhereClause } = await import('../features.js');
    const { where, params } = buildWhereClause({});
    expect(where).toBe('');
    expect(params).toEqual([]);
  });

  it('filters by priority', async () => {
    const { buildWhereClause } = await import('../features.js');
    const { where, params } = buildWhereClause({ priority: 'P0' });
    expect(where).toBe('WHERE priority = $1');
    expect(params).toEqual(['P0']);
  });

  it('handles smoke_cmd null filter', async () => {
    const { buildWhereClause } = await import('../features.js');
    const { where, params } = buildWhereClause({ smoke_cmd: 'null' });
    expect(where).toBe('WHERE smoke_cmd IS NULL');
    expect(params).toEqual([]);
  });

  it('combines domain and area filters', async () => {
    const { buildWhereClause } = await import('../features.js');
    const { where, params } = buildWhereClause({ domain: 'brain', area: 'health' });
    expect(where).toContain('domain = $1');
    expect(where).toContain('area = $2');
    expect(params).toEqual(['brain', 'health']);
  });
});

describe('features HTTP brain_modules与账本计算', () => {
  async function app() { const a = express(); a.use(express.json()); a.use('/features', (await import('../features.js')).default); return a; }
  it('列表实际查询brain_modules并绑定过滤参数', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'owned' }] });
    const r = await request(await app()).get('/features?priority=P0&domain=brain');
    expect(r.status).toBe(200); expect(r.body).toEqual({ features: [{ id: 'owned' }], total: 1 });
    expect(query.mock.calls[0][0]).toMatch(/FROM brain_modules WHERE priority = \$1 AND domain = \$2/);
    expect(query.mock.calls[0][1]).toEqual(['P0', 'brain']);
  });
  it('ledger实际合并决策统计并计算模块健康', async () => {
    query.mockResolvedValueOnce({ rows: [
      { id: 'covered', domain: 'brain', description: 'FR', has_unit_test: true, smoke_cmd: 'owned smoke', smoke_status: 'passing' },
      { id: 'bare', domain: null },
    ] }).mockResolvedValueOnce({ rows: [{ target_id: 'covered', cnt: '2' }] }).mockResolvedValueOnce({ rows: [{ target_id: 'covered', cnt: '1' }] });
    const r = await request(await app()).get('/features/ledger');
    expect(r.status).toBe(200); expect(r.body.total).toBe(2);
    expect(query.mock.calls[0][0]).toMatch(/FROM brain_modules/);
    expect(query.mock.calls[1][0]).toMatch(/category = 'nfr'/); expect(query.mock.calls[2][0]).toMatch(/category = 'invariant'/);
    expect(r.body.domains[0].items[0].ledger).toMatchObject({ fr: 'ok', nfr: 'ok', invariant: 'ok', checkpoints: 1, checkpoints_status: 'partial', effect_confirmed: 'ok' });
    expect(r.body.domains[1]).toMatchObject({ domain: '(未分类)', items: [{ id: 'bare', ledger: { fr: 'missing', nfr: 'missing', invariant: 'missing', checkpoints: 0 } }] });
  });
  it('新增和PATCH均操作brain_modules并绑定请求字段', async () => {
    query.mockResolvedValue({ rows: [{ id: 'owned' }] }); const a = await app();
    expect((await request(a).post('/features').send({ id: 'owned', name: 'Owned', domain: 'brain' })).status).toBe(201);
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO brain_modules/); expect(query.mock.calls[0][1].slice(0, 3)).toEqual(['owned', 'Owned', 'brain']);
    expect((await request(a).patch('/features/owned').send({ name: 'Updated' })).status).toBe(200);
    expect(query.mock.calls[1][0]).toMatch(/UPDATE brain_modules SET name = \$1/);
    expect(query.mock.calls[1][1]).toEqual(['Updated', expect.any(String), 'owned']);
  });
});
