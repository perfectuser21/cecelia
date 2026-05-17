/**
 * Knowledge Routes Unit Tests (mock pool — no real DB needed)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js before importing routes
vi.mock('../db.js', () => {
  const mockPool = {
    query: vi.fn(),
  };
  return { default: mockPool };
});

import pool from '../db.js';
import knowledgeRoutes from '../routes/knowledge.js';

// Helper: create mock req/res
function mockReqRes(query = {}) {
  const req = { query };
  const res = {
    _data: null,
    _status: 200,
    json(data) { this._data = data; return this; },
    status(code) { this._status = code; return this; },
  };
  return { req, res };
}

function getHandler() {
  const layers = knowledgeRoutes.stack.filter(l => l.route?.path === '/');
  const layer = layers[0];
  return layer?.route?.stack?.[0]?.handle;
}

describe('GET /api/brain/knowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns JSON array of knowledge items', async () => {
    const mockRows = [
      { id: '1', name: 'DoD test only', type: 'learning_rule', status: 'Active', sub_area: 'test.md', content: '{}', created_at: new Date() },
      { id: '2', name: 'Commit prefix matters', type: 'learning_rule', status: 'Active', sub_area: 'test2.md', content: '{}', created_at: new Date() },
    ];
    pool.query.mockResolvedValueOnce({ rows: mockRows });

    const { req, res } = mockReqRes({ type: 'learning_rule' });
    const handler = getHandler();
    await handler(req, res);

    expect(Array.isArray(res._data)).toBe(true);
    expect(res._data.length).toBe(2);
  });

  it('filters by type when type param provided', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const { req, res } = mockReqRes({ type: 'learning_rule' });
    const handler = getHandler();
    await handler(req, res);

    const [queryText, queryParams] = pool.query.mock.calls[0];
    expect(queryText).toContain('WHERE type');
    expect(queryParams).toContain('learning_rule');
  });

  it('returns all items when no type param', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const { req, res } = mockReqRes({});
    const handler = getHandler();
    await handler(req, res);

    const [queryText] = pool.query.mock.calls[0];
    expect(queryText).not.toContain('WHERE type');
  });
});
