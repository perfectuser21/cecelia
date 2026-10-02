import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerHeadedTakeoverRoute } from '../task-headed-takeover.js';

const taskId = '723b0de1-11a5-4170-ac62-bfba9e50d6ac';
const input = {
  requestId: 'd892fb70-fc20-4a66-8031-61cf28c537b5', sessionId: 'fixture-session',
  expectedRowVersion: 0, expectedExecutorKind: 'bridge', expectedCurrentRunId: null,
};
const token = 'isolated-takeover-route-test';
let app, pool;
beforeEach(() => {
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', token);
  pool = { connect: vi.fn(), query: vi.fn() };
  app = express(); app.use(express.json());
  const router = express.Router(); registerHeadedTakeoverRoute(router, { pool }); app.use(router);
});
afterEach(() => vi.unstubAllEnvs());

function post(body = input) {
  return request(app).post(`/tasks/${taskId}/headed-takeover`).set('X-Session-Id', input.sessionId).send(body);
}
function noDatabase() {
  expect(pool.query).not.toHaveBeenCalled(); expect(pool.connect).not.toHaveBeenCalled();
}

describe('真实HTTP接管入口的前置拒绝', () => {
  it('未配置生产内部凭据返回503，不能触达任务账', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', '');
    const response = await post().set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(503); expect(response.body.error).toBe('INTERNAL_AUTH_NOT_CONFIGURED'); noDatabase();
  });

  it.each([undefined, 'short', 'isolated-takeover-route-tesx'])('缺失或错误Bearer凭据返回401：%s', async supplied => {
    const pending = post(); if (supplied !== undefined) pending.set('Authorization', `Bearer ${supplied}`);
    const response = await pending;
    expect(response.status).toBe(401); expect(response.body.error).toBe('UNAUTHORIZED'); noDatabase();
  });

  it('请求正文不能冒充另一个会话', async () => {
    const response = await post({ ...input, sessionId: 'other-session' }).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(400); expect(response.body.error).toBe('headed_session_mismatch'); noDatabase();
  });

  it('有合法token但输入伪执行者仍在连接前拒绝', async () => {
    const response = await post({ ...input, expectedExecutorKind: 'phone-ssh-controller' }).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(400); expect(response.body.error).toBe('headed_takeover_input_invalid'); noDatabase();
  });

  it('连接失效返回500，不能回退为成功接管', async () => {
    pool.connect.mockRejectedValue(new Error('fixture connection unavailable'));
    const response = await post().set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(500); expect(response.body.error).toBe('fixture connection unavailable');
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('真实HTTP与事务接管helper连接', () => {
  it('忙闸返回409，回滚原连接且无任务查询或写入', async () => {
    const db = {
      query: vi.fn().mockImplementation(async sql => ({ rows: sql.includes('pg_try_advisory') ? [{ acquired: false }] : [] })),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(db);
    const response = await post().set('X-Internal-Token', token);
    expect(response.status).toBe(409); expect(response.body.error).toBe('headed_task_owner_busy');
    expect(db.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED', expect.stringContaining('pg_try_advisory_xact_lock'), 'ROLLBACK',
    ]);
    expect(db.release).toHaveBeenCalledTimes(1);
  });

  it('同request及同session重入返回持久owner，不能重复修改任务或制造事件', async () => {
    const stored = {
      task_id: taskId, generation: 'durable-fixture-generation', request_id: input.requestId,
      session_id: input.sessionId, previous_run_id: null, previous_owner: { row_version: 0 },
    };
    const db = {
      query: vi.fn().mockImplementation(async sql => {
        if (sql.includes('pg_try_advisory')) return { rows: [{ acquired: true }] };
        if (sql.includes('FROM headed_task_takeovers')) return { rows: [stored] };
        if (sql.includes('SELECT * FROM tasks')) return { rows: [{ id: taskId, status: 'in_progress' }] };
        return { rows: [] };
      }), release: vi.fn(),
    };
    pool.connect.mockResolvedValue(db);
    const response = await post().set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200); expect(response.body).toEqual(stored);
    const statements = db.query.mock.calls.map(([sql]) => sql);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements.some(sql => /^\s*(INSERT|UPDATE)/.test(sql))).toBe(false);
    expect(db.release).toHaveBeenCalledTimes(1);
  });
});
