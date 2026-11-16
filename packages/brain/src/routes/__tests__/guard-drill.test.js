import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), reset: vi.fn(), run: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: mocks.query } }));
vi.mock('../../guard-drill.js', () => ({
  GUARD_REGISTRY: [
    { id: 'recent', name: 'Recent', file: 'recent.js', auto: true, boundary: 'owner' },
    { id: 'stale', name: 'Stale', file: 'stale.js', auto: false, boundary: 'lease' },
    { id: 'never', name: 'Never', file: 'never.js', auto: false, boundary: 'unknown' },
  ],
  runGuardDrill: mocks.run, __resetGuardDrillForTest: mocks.reset,
}));
import router from '../guard-drill.js';
function app() { const a = express(); a.use('/guard-drill', router); return a; }
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-16T00:00:00Z')); });
afterEach(() => vi.useRealTimers());
describe('guard-drill HTTP', () => {
  it('90天边界、过期和从未验火的真实响应', async () => {
    const now = Date.now();
    mocks.query.mockResolvedValueOnce({ rows: [{ value_json: {
      recent: { last_verified_at: new Date(now - 90 * 86400000).toISOString(), last_drill_at: 'last-drill', last_drill_fired: false },
      stale: { last_verified_at: new Date(now - 91 * 86400000).toISOString() },
    } }] }).mockResolvedValueOnce({ rows: [{ value_json: { fired: 2 }, updated_at: 'last-run' }] });
    const r = await request(app()).get('/guard-drill/status');
    expect(r.status).toBe(200);
    expect(r.body.stale_threshold_days).toBe(90);
    expect(r.body.guards).toEqual([
      { id: 'recent', name: 'Recent', file: 'recent.js', auto: true, boundary: 'owner', last_verified_at: new Date(now - 90 * 86400000).toISOString(), last_drill_at: 'last-drill', last_drill_fired: false, stale: false, days_since_verified: 90 },
      { id: 'stale', name: 'Stale', file: 'stale.js', auto: false, boundary: 'lease', last_verified_at: new Date(now - 91 * 86400000).toISOString(), last_drill_at: null, last_drill_fired: null, stale: true, days_since_verified: 91 },
      { id: 'never', name: 'Never', file: 'never.js', auto: false, boundary: 'unknown', last_verified_at: null, last_drill_at: null, last_drill_fired: null, stale: true, days_since_verified: null },
    ]);
    expect(r.body.last_run).toEqual({ fired: 2 }); expect(r.body.last_run_at).toBe('last-run');
    expect(mocks.query.mock.calls[0][0]).toContain("key='guard-drill-status'");
    expect(mocks.query.mock.calls[1][0]).toContain("key='guard-drill-last-run'");
  });
  it('无台账记录时last_run为空、全部stale且天数为null', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const r = await request(app()).get('/guard-drill/status');
    expect(r.status).toBe(200); expect(r.body.last_run).toBeNull(); expect(r.body.last_run_at).toBeNull();
    expect(r.body.guards).toHaveLength(3);
    for (const g of r.body.guards) expect(g).toMatchObject({ stale: true, days_since_verified: null });
  });
  it('查询异常返回500', async () => {
    mocks.query.mockRejectedValue(new Error('owned db failure'));
    const r = await request(app()).get('/guard-drill/status');
    expect(r.status).toBe(500); expect(r.body.error).toBe('owned db failure');
  });
  it('trigger先重置gate再运行并透传结果', async () => {
    mocks.run.mockResolvedValue({ fired: 1 });
    const r = await request(app()).post('/guard-drill/trigger');
    expect(r.status).toBe(200); expect(r.body).toEqual({ ok: true, result: { fired: 1 } });
    expect(mocks.reset).toHaveBeenCalledOnce(); expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.reset.mock.invocationCallOrder[0]).toBeLessThan(mocks.run.mock.invocationCallOrder[0]);
  });
  it('trigger异常不能返回成功', async () => {
    mocks.run.mockRejectedValue(new Error('owned drill failure'));
    const r = await request(app()).post('/guard-drill/trigger');
    expect(r.status).toBe(500); expect(r.body.error).toBe('owned drill failure');
  });
});
