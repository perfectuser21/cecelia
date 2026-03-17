/**
 * GET /api/brain/capacity 端点测试
 * DoD: capacity 端点返回 max_seats 字段（数字类型）
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

let routes;

function mockReqRes() {
  const req = { body: {}, params: {}, query: {} };
  const res = {
    _status: 200,
    _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}

function getHandler(method, path) {
  const layers = routes.stack.filter(
    l => l.route && l.route.methods[method] && l.route.path === path
  );
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

describe('GET /capacity', () => {
  beforeAll(async () => {
    vi.resetModules();
    routes = (await import('../routes.js')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回 max_seats 字段且为数字', async () => {
    const handler = getHandler('get', '/capacity');
    const { req, res } = mockReqRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(typeof res._data.max_seats).toBe('number');
    expect(res._data.max_seats).toBeGreaterThanOrEqual(1);
  });

  it('返回 interactive_reserve / physical / budget 字段', async () => {
    const handler = getHandler('get', '/capacity');
    const { req, res } = mockReqRes();
    await handler(req, res);
    expect(res._data).toHaveProperty('interactive_reserve');
    expect(res._data).toHaveProperty('physical');
    expect(res._data).toHaveProperty('budget');
  });
});
