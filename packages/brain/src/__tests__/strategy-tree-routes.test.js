/**
 * Strategy Tree Route Unit Tests (mock pool — no real DB needed)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => {
  const mockPool = { query: vi.fn() };
  return { default: mockPool };
});

import pool from '../db.js';
import strategyTreeRoutes from '../routes/strategy-tree.js';

function mockReqRes() {
  const req = { query: {} };
  const res = {
    _data: null,
    _status: 200,
    json(data) { this._data = data; return this; },
    status(code) { this._status = code; return this; },
  };
  return { req, res };
}

function getHandler() {
  const layers = strategyTreeRoutes.stack.filter(l => l.route?.path === '/');
  return layers[0]?.route?.stack?.[0]?.handle;
}

describe('GET /api/brain/strategy-tree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success:true with areas array', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'a1', name: 'Cecelia', description: '', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'o1', title: 'OKR1', status: 'active', area_id: 'a1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'KR1', status: 'active', objective_id: 'o1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1', title: 'Project1', status: 'active', kr_id: 'kr1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 's1', title: 'Scope1', status: 'active', project_id: 'p1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'Initiative1', status: 'active', scope_id: 's1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 't1', title: 'Task1', status: 'done', initiative_id: 'i1', branch: 'cp-test', pr_url: null, pr_title: null, learning_summary: null }] });

    const { req, res } = mockReqRes();
    await getHandler()(req, res);

    expect(res._data.success).toBe(true);
    expect(Array.isArray(res._data.areas)).toBe(true);
    expect(res._data.areas.length).toBe(1);
    expect(res._data.areas[0].name).toBe('Cecelia');
  });

  it('returns progress rollup: completed 1/1 task = 100%', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'a1', name: 'Area', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'o1', title: 'Obj', status: 'active', area_id: 'a1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'KR', status: 'active', objective_id: 'o1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1', title: 'Proj', status: 'active', kr_id: 'kr1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 's1', title: 'Scope', status: 'active', project_id: 'p1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'Init', status: 'active', scope_id: 's1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 't1', title: 'Task', status: 'done', initiative_id: 'i1' }] });

    const { req, res } = mockReqRes();
    await getHandler()(req, res);

    const area = res._data.areas[0];
    expect(area.total_tasks).toBe(1);
    expect(area.completed_tasks).toBe(1);
    expect(area.progress).toBe(100);
  });

  it('returns empty areas array when no areas', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { req, res } = mockReqRes();
    await getHandler()(req, res);

    expect(res._data.success).toBe(true);
    expect(res._data.areas).toEqual([]);
  });

  it('returns 500 on DB error', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    const { req, res } = mockReqRes();
    await getHandler()(req, res);

    expect(res._status).toBe(500);
    expect(res._data.success).toBe(false);
  });
});
