/**
 * warroom-line-command.test.js
 *
 * 验证 GET /warroom/line/:id/command 中 open issues 查询
 * 使用 journey_id 列（不是 payload->>'journey_id'）——migration 322 后 issues 表有专用列。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('./status.js', () => ({ buildPipelineRecord: () => ({}) }), { virtual: false });

let routes;
function mockReqRes(body = {}, params = {}, query = {}) {
  const req = { body, params, query };
  const res = {
    _status: 200, _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}
function getHandler(method, path) {
  const layers = routes.stack.filter(l => l.route && l.route.methods[method] && l.route.path === path);
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

const JOURNEY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

// 每次调用 handler 需要 mock 8 个顺序查询：
// 1. journey 本体, 2. notes/决策, 3. journey_features, 4. advancement_items,
// 5. active tasks, 6. open issues, 7. initiative_runs (health), 8. pr count
function mockAllQueries({ issues = [] } = {}) {
  // 1. journey 本体
  mockPool.query.mockResolvedValueOnce({ rows: [{ id: JOURNEY_ID, notion_id: 'notion-j1', name: 'Line 05 视频剪辑', description: null, status: 'active', maturity: 'medium' }] });
  // 2. notes（军师决策）
  mockPool.query.mockResolvedValueOnce({ rows: [] });
  // 3. journey_features
  mockPool.query.mockResolvedValueOnce({ rows: [] });
  // 4. advancement_items
  mockPool.query.mockResolvedValueOnce({ rows: [] });
  // 5. active tasks
  mockPool.query.mockResolvedValueOnce({ rows: [] });
  // 6. open issues ← 被测目标
  mockPool.query.mockResolvedValueOnce({ rows: issues });
  // 7. initiative_runs (health rows)
  mockPool.query.mockResolvedValueOnce({ rows: [] });
  // 8. pr count
  mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
}

describe('GET /warroom/line/:id/command — open issues 查询使用 journey_id 列', () => {
  beforeAll(async () => {
    vi.resetModules();
    routes = (await import('../routes/warroom.js')).default;
  });
  beforeEach(() => mockPool.query.mockReset());

  it('issues 查询参数是 journey.id（UUID），不是 keys 数组', async () => {
    mockAllQueries();
    const handler = getHandler('get', '/line/:id/command');
    const { req, res } = mockReqRes({}, { id: JOURNEY_ID });
    await handler(req, res);
    expect(res._status).toBe(200);

    // call[5] 是第 6 次查询 = open issues
    const [issueSql, issueParams] = mockPool.query.mock.calls[5];
    expect(issueSql).toMatch(/FROM issues/);
    // 必须用 journey_id 列，不是 payload 字段
    expect(issueSql).toMatch(/journey_id\s*=\s*\$1/);
    expect(issueSql).not.toMatch(/payload/);
    // 参数是单个 UUID，不是数组
    expect(issueParams).toEqual([JOURNEY_ID]);
  });

  it('返回 open issues 列表', async () => {
    const mockIssue = { id: 'iss-1', title: '登录 cookie 过期', priority: 'P1', status: 'In progress', created_at: '2026-07-01T00:00:00Z' };
    mockAllQueries({ issues: [mockIssue] });
    const handler = getHandler('get', '/line/:id/command');
    const { req, res } = mockReqRes({}, { id: JOURNEY_ID });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.connections.open_issues).toHaveLength(1);
    expect(res._data.connections.open_issues[0].title).toBe('登录 cookie 过期');
  });

  it('journey 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const handler = getHandler('get', '/line/:id/command');
    const { req, res } = mockReqRes({}, { id: 'no-such-id' });
    await handler(req, res);
    expect(res._status).toBe(404);
  });
});
