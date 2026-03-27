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

// Mock fs to avoid reading real BACKLOG.yaml in tests
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from 'fs';

import pool from '../db.js';
import knowledgeRoutes from '../routes/knowledge.js';

const MOCK_BACKLOG_YAML = `
meta:
  total: 2
  done: 1
brain:
  - id: brain-tick-loop
    title: 心跳系统（Tick Loop）
    desc: 5秒循环检查
    priority: P0
    status: done
    source_files:
      - packages/brain/src/tick.js
engine:
  - id: engine-devgate
    title: DevGate 门禁
    desc: CI 质量门禁
    priority: P1
    status: done
    source_files:
      - packages/engine/scripts/devgate/check-dod-mapping.cjs
system: []
workflows: []
`;

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

describe('GET /api/brain/knowledge/modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileSync.mockReturnValue(MOCK_BACKLOG_YAML);
  });

  function getModulesHandler() {
    const layers = knowledgeRoutes.stack.filter(l => l.route?.path === '/modules');
    return layers[0]?.route?.stack?.[0]?.handle;
  }

  it('returns grouped modules from BACKLOG.yaml', async () => {
    const { req, res } = mockReqRes();
    req.query = {};
    const handler = getModulesHandler();
    handler(req, res);

    expect(res._data).toBeDefined();
    expect(res._data.groups).toBeDefined();
    expect(Array.isArray(res._data.groups.brain)).toBe(true);
    expect(res._data.groups.brain[0].id).toBe('brain-tick-loop');
  });

  it('includes priority and desc in each module', async () => {
    const { req, res } = mockReqRes();
    req.query = {};
    const handler = getModulesHandler();
    handler(req, res);

    const brainModule = res._data.groups.brain[0];
    expect(brainModule.priority).toBe('P0');
    expect(brainModule.desc).toBe('5秒循环检查');
  });

  it('includes source_files in each module', async () => {
    const { req, res } = mockReqRes();
    req.query = {};
    const handler = getModulesHandler();
    handler(req, res);

    const brainModule = res._data.groups.brain[0];
    expect(Array.isArray(brainModule.source_files)).toBe(true);
    expect(brainModule.source_files[0]).toBe('packages/brain/src/tick.js');
  });

  it('returns all four groups even if empty', async () => {
    const { req, res } = mockReqRes();
    req.query = {};
    const handler = getModulesHandler();
    handler(req, res);

    expect(Array.isArray(res._data.groups.system)).toBe(true);
    expect(Array.isArray(res._data.groups.workflows)).toBe(true);
  });
});
