/**
 * 部门主管缺失 API 测试
 *
 * 覆盖：
 * - GET /api/brain/goals（含 ?dept= 过滤）
 * - POST /api/brain/pending-actions（创建提案）
 *
 * 采用直接测试 handler 逻辑的方式，mock pool。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Mock pool
// ============================================================
const mockPool = {
  query: vi.fn(),
};

// ============================================================
// Handler 复现（与 routes.js 保持一致）
// ============================================================

async function handleGetGoals(req, res) {
  try {
    const { dept } = req.query || {};
    let query = `
      SELECT id, title, type, status, priority, progress, weight, parent_id, metadata, created_at, updated_at
      FROM goals
    `;
    const params = [];
    if (dept) {
      query += ` WHERE metadata->>'dept' = $1`;
      params.push(dept);
    }
    query += ` ORDER BY priority ASC, created_at DESC`;
    const result = await mockPool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get goals', details: err.message });
  }
}

async function handleCreatePendingAction(req, res) {
  try {
    const { action_type, requester, context } = req.body || {};
    if (!action_type || !requester) {
      return res.status(400).json({ error: 'action_type and requester are required' });
    }
    const result = await mockPool.query(`
      INSERT INTO pending_actions
        (action_type, params, context, status, source, comments)
      VALUES ($1, '{}', $2, 'pending_approval', 'repo-lead', '[]'::jsonb)
      RETURNING id, action_type, status, source, created_at
    `, [action_type, JSON.stringify({ requester, ...(context || {}) })]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create pending action', details: err.message });
  }
}

// ============================================================
// Helper
// ============================================================
function makeMockRes() {
  const res = {
    _status: 200,
    _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return res;
}

// ============================================================
// Tests: GET /api/brain/goals
// ============================================================

describe('GET /api/brain/goals', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('should return all goals when no dept filter', async () => {
    const rows = [
      { id: 'g1', title: 'ZenithJoy OKR', type: 'area_okr', status: 'in_progress', metadata: { dept: 'zenithjoy' } },
      { id: 'g2', title: 'Global OKR', type: 'global_okr', status: 'in_progress', metadata: {} },
    ];
    mockPool.query.mockResolvedValue({ rows });

    const req = { query: {} };
    const res = makeMockRes();
    await handleGetGoals(req, res);

    expect(res._status).toBe(200);
    expect(res._data).toEqual(rows);
    // No dept filter: no $1 param
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).not.toContain("metadata->>'dept'");
    expect(params).toHaveLength(0);
  });

  it('should filter goals by dept when ?dept= is provided', async () => {
    const rows = [
      { id: 'g1', title: 'ZenithJoy OKR', type: 'area_okr', status: 'in_progress', metadata: { dept: 'zenithjoy' } },
    ];
    mockPool.query.mockResolvedValue({ rows });

    const req = { query: { dept: 'zenithjoy' } };
    const res = makeMockRes();
    await handleGetGoals(req, res);

    expect(res._status).toBe(200);
    expect(res._data).toEqual(rows);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain("metadata->>'dept'");
    expect(params).toEqual(['zenithjoy']);
  });

  it('should return empty array when no goals match dept', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const req = { query: { dept: 'nonexistent' } };
    const res = makeMockRes();
    await handleGetGoals(req, res);

    expect(res._status).toBe(200);
    expect(res._data).toEqual([]);
  });

  it('should return 500 on DB error', async () => {
    mockPool.query.mockRejectedValue(new Error('DB down'));

    const req = { query: {} };
    const res = makeMockRes();
    await handleGetGoals(req, res);

    expect(res._status).toBe(500);
    expect(res._data.error).toBe('Failed to get goals');
  });
});

// ============================================================
// Tests: POST /api/brain/pending-actions
// ============================================================

describe('POST /api/brain/pending-actions', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('should create a pending action and return 201', async () => {
    const created = {
      id: 'pa-uuid',
      action_type: 'request_more_slots',
      status: 'pending_approval',
      source: 'repo-lead',
      created_at: new Date().toISOString(),
    };
    mockPool.query.mockResolvedValue({ rows: [created] });

    const req = {
      body: {
        action_type: 'request_more_slots',
        requester: 'repo-lead:zenithjoy',
        context: { reason: 'Need 1 more slot' },
      },
    };
    const res = makeMockRes();
    await handleCreatePendingAction(req, res);

    expect(res._status).toBe(201);
    expect(res._data.id).toBe('pa-uuid');
    expect(res._data.status).toBe('pending_approval');
    expect(res._data.source).toBe('repo-lead');
  });

  it('should pass action_type and context (with requester) to DB', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 'x', action_type: 'request_okr', status: 'pending_approval', source: 'repo-lead', created_at: new Date() }] });

    const req = {
      body: {
        action_type: 'request_okr',
        requester: 'repo-lead:zenithjoy',
      },
    };
    const res = makeMockRes();
    await handleCreatePendingAction(req, res);

    const [, params] = mockPool.query.mock.calls[0];
    expect(params[0]).toBe('request_okr');
    const context = JSON.parse(params[1]);
    expect(context.requester).toBe('repo-lead:zenithjoy');
  });

  it('should return 400 when action_type is missing', async () => {
    const req = { body: { requester: 'repo-lead:zenithjoy' } };
    const res = makeMockRes();
    await handleCreatePendingAction(req, res);

    expect(res._status).toBe(400);
    expect(res._data.error).toContain('action_type and requester are required');
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('should return 400 when requester is missing', async () => {
    const req = { body: { action_type: 'request_more_slots' } };
    const res = makeMockRes();
    await handleCreatePendingAction(req, res);

    expect(res._status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('should return 500 on DB error', async () => {
    mockPool.query.mockRejectedValue(new Error('insert failed'));

    const req = {
      body: { action_type: 'request_more_slots', requester: 'repo-lead:zenithjoy' },
    };
    const res = makeMockRes();
    await handleCreatePendingAction(req, res);

    expect(res._status).toBe(500);
    expect(res._data.error).toBe('Failed to create pending action');
  });
});
