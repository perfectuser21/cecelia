/**
 * POST /spans 入库成功后把新插入的 span 交给自动裁判钩子（五块模型·裁判，决策 de6dff5d）；
 * 钩子炸了也不能让上报失败；写入失败不触发裁判。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ writeSpans: vi.fn(), onSpansWritten: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../middleware/internal-auth.js', () => ({ internalAuthOrLoopback: (_q, _s, next) => next() }));
vi.mock('../lib/span-ingestion.js', async importOriginal => ({ ...(await importOriginal()), writeSpans: mocks.writeSpans }));
vi.mock('../lib/activity-judge.js', () => ({ onSpansWritten: mocks.onSpansWritten }));

let routes;
const reqRes = body => {
  const req = { body, params: {}, query: {}, headers: {}, ip: '127.0.0.1' };
  const res = { _status: 200, _data: null, status(c) { this._status = c; return this; }, json(d) { this._data = d; return this; } };
  return { req, res };
};
const post = () => routes.stack.find(l => l.route?.methods.post && l.route.path === '/spans').route.stack.at(-1).handle;
const SPAN = { run_id: 'r1', activity_id: 'c1000000-0000-4000-8000-000000000001', started_at: '2026-10-10T00:00:00Z', executor_kind: 'code', outcome: 'pass' };

beforeAll(async () => { vi.resetModules(); routes = (await import('./spans.js')).default; });
beforeEach(() => Object.values(mocks).forEach(m => m.mockReset()));

describe('POST /spans → 自动裁判钩子', () => {
  it('写入成功：把写入结果交给钩子，响应不变', async () => {
    const out = { inserted: 1, skipped: 0, count: 1, ids: ['e1'] };
    mocks.writeSpans.mockResolvedValue(out);
    const { req, res } = reqRes(SPAN);
    await post()(req, res);
    expect(res._status).toBe(200);
    expect(res._data).toEqual(out);
    expect(mocks.onSpansWritten).toHaveBeenCalledWith(expect.anything(), out);
  });

  it('钩子同步抛错也不影响上报结果', async () => {
    mocks.writeSpans.mockResolvedValue({ inserted: 1, skipped: 0, count: 1, ids: ['e1'] });
    mocks.onSpansWritten.mockImplementation(() => { throw new Error('judge exploded'); });
    const { req, res } = reqRes(SPAN);
    await post()(req, res);
    expect(res._status).toBe(200);
    expect(res._data.inserted).toBe(1);
  });

  it('写入失败不触发裁判', async () => {
    mocks.writeSpans.mockRejectedValue(new Error('db down'));
    const { req, res } = reqRes(SPAN);
    await post()(req, res);
    expect(res._status).toBe(500);
    expect(mocks.onSpansWritten).not.toHaveBeenCalled();
  });
});
