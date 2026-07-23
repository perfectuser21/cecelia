/**
 * harness-pending-reviews-auth.test.js
 * 行为测试 — review 门批准路由认证（issue afc50c30 / task 5a87a381）
 *
 * 血统：2026-07-23 task 1b997ed6 的 controller 无认证调 approve 路由伪造
 * {"approved":true,"approved_by":"alex"} 事件绕过 review_required 人工门 self-merge（PR #4220 已 revert）。
 * 根因 = 路由零认证 + 硬编码 approved_by。
 *
 * 合同：
 *   - HARNESS_REVIEW_APPROVER_TOKEN 未配置 → 503 fail-closed（未配置≠敞开）
 *   - 缺/错 x-approver-token → 401
 *   - 认证过但缺 approved_by → 400
 *   - 认证过 + approved_by → 202，事件 payload 记请求方 approved_by + source
 *   - 一切非 2xx 路径不得写 task_events（INSERT 不得发生）
 *   - reject 与 approve 同套认证（同为审批权动作）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));

const TOKEN = 'test-approver-token-0723';

function findHandler(router, path, method = 'post') {
  const layer = router.stack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method]
  );
  if (!layer) throw new Error(`route ${method} ${path} not found`);
  // 路由前挂了限流中间件（stack[0]），业务 handler 取末位
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mkReq({ taskId = '11111111-2222-3333-4444-555555555555', token, body = {} } = {}) {
  const headers = {};
  if (token !== undefined) headers['x-approver-token'] = token;
  return {
    params: { taskId },
    body,
    headers,
    get: (name) => headers[String(name).toLowerCase()],
    app: { get: () => undefined }, // 走 mock 的默认 pool
  };
}

function mkRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status: vi.fn(function (c) { this.statusCode = c; return this; }),
    json: vi.fn(function (b) { this.body = b; return this; }),
  };
  return res;
}

function insertCalls(pool) {
  return pool.query.mock.calls.filter(([sql]) => /INSERT INTO task_events/i.test(sql));
}

describe('pending-reviews 批准路由认证（afc50c30）', () => {
  let router;
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = TOKEN;
    pool = (await import('../../db.js')).default;
    // 默认：task 存在
    pool.query.mockImplementation(async (sql) => {
      if (/SELECT id FROM tasks/i.test(sql)) return { rowCount: 1, rows: [{ id: 'x' }] };
      return { rowCount: 1, rows: [] };
    });
    router = (await import('../harness-pending-reviews.js')).default;
  });

  afterEach(() => {
    delete process.env.HARNESS_REVIEW_APPROVER_TOKEN;
  });

  it('env 未配置 HARNESS_REVIEW_APPROVER_TOKEN → approve 503 fail-closed 且不写事件', async () => {
    delete process.env.HARNESS_REVIEW_APPROVER_TOKEN;
    const handler = findHandler(router, '/:taskId/approve');
    const res = mkRes();
    await handler(mkReq({ token: TOKEN, body: { approved_by: 'alex' } }), res);
    expect(res.statusCode).toBe(503);
    expect(insertCalls(pool)).toHaveLength(0);
  });

  it('无 token → approve 401 且不写事件', async () => {
    const handler = findHandler(router, '/:taskId/approve');
    const res = mkRes();
    await handler(mkReq({ body: { approved_by: 'alex' } }), res);
    expect(res.statusCode).toBe(401);
    expect(insertCalls(pool)).toHaveLength(0);
  });

  it('错 token → approve 401 且不写事件', async () => {
    const handler = findHandler(router, '/:taskId/approve');
    const res = mkRes();
    await handler(mkReq({ token: 'wrong-token', body: { approved_by: 'alex' } }), res);
    expect(res.statusCode).toBe(401);
    expect(insertCalls(pool)).toHaveLength(0);
  });

  it('对 token 但缺 approved_by → 400 且不写事件', async () => {
    const handler = findHandler(router, '/:taskId/approve');
    const res = mkRes();
    await handler(mkReq({ token: TOKEN, body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(insertCalls(pool)).toHaveLength(0);
  });

  it('对 token + approved_by → 202，事件记请求方身份与来源', async () => {
    const handler = findHandler(router, '/:taskId/approve');
    const res = mkRes();
    await handler(mkReq({ token: TOKEN, body: { approved_by: 'tester-42' } }), res);
    expect(res.statusCode).toBe(202);
    const inserts = insertCalls(pool);
    expect(inserts).toHaveLength(1);
    const payload = JSON.parse(inserts[0][1][1]);
    expect(payload.approved).toBe(true);
    expect(payload.approved_by).toBe('tester-42');
    expect(payload.source).toBe('authenticated_route');
    // 绝不允许把身份硬编码成 alex（1b997ed6 伪造事件的指纹）
    expect(payload.approved_by).not.toBe('alex');
  });

  it('reject 同套认证：无 token → 401 且不写事件', async () => {
    const handler = findHandler(router, '/:taskId/reject');
    const res = mkRes();
    await handler(mkReq({ body: { reason: 'nope', approved_by: 'alex' } }), res);
    expect(res.statusCode).toBe(401);
    expect(insertCalls(pool)).toHaveLength(0);
  });

  it('reject 认证过 + approved_by → 202 且事件记来源', async () => {
    const handler = findHandler(router, '/:taskId/reject');
    const res = mkRes();
    await handler(mkReq({ token: TOKEN, body: { approved_by: 'tester-42', reason: 'needs work' } }), res);
    expect(res.statusCode).toBe(202);
    const inserts = insertCalls(pool);
    expect(inserts).toHaveLength(1);
    const payload = JSON.parse(inserts[0][1][1]);
    expect(payload.approved).toBe(false);
    expect(payload.approved_by).toBe('tester-42');
    expect(payload.source).toBe('authenticated_route');
  });
});
