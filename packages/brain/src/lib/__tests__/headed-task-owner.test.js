import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertAutomaticTaskOwner, headedPostcommitPool, takeOverHeadedTask } from '../headed-task-owner.js';

const taskId = '723b0de1-11a5-4170-ac62-bfba9e50d6ac';
const owner = { task_id: taskId, generation: 'fixture-generation', session_id: 'fixture-session' };
const handoffSql = "UPDATE tasks SET result=result||jsonb_build_object('handoff', $2::jsonb) WHERE id=$1::uuid";
const validInput = {
  taskId, requestId: 'd892fb70-fc20-4a66-8031-61cf28c537b5', sessionId: 'fixture-session',
  expectedRowVersion: 0, expectedExecutorKind: 'bridge', expectedCurrentRunId: null,
};
afterEach(() => vi.restoreAllMocks());

describe('自动执行者与接管所有权', () => {
  it('已接管单在任何自动副作用之前拒绝', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ headed_takeover: owner }] }), connect: vi.fn() };
    await expect(assertAutomaticTaskOwner(pool, taskId)).rejects.toMatchObject({ statusCode: 409, message: 'headed_task_owned' });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][1]).toEqual([taskId]);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it.each([{ rows: [] }, { rows: [{ headed_takeover: null }] }])('普通单保持原自动入口', async ({ rows }) => {
    await expect(assertAutomaticTaskOwner({ query: vi.fn().mockResolvedValue({ rows }) }, taskId)).resolves.toBeUndefined();
  });

  it('所有权查询失败向调用者传播，不能当作无人持有', async () => {
    const error = new Error('fixture ownership database unavailable');
    await expect(assertAutomaticTaskOwner({ query: vi.fn().mockRejectedValue(error) }, taskId)).rejects.toBe(error);
  });

  it.each([
    { taskId: 'invalid' }, { requestId: 'invalid' }, { sessionId: 'space not allowed' },
    { expectedRowVersion: -1 }, { expectedRowVersion: 0.5 },
    { expectedExecutorKind: 'headed-session' }, { expectedCurrentRunId: true },
  ])('无效接管身份在取得数据库连接之前拒绝：%j', async change => {
    const pool = { connect: vi.fn() };
    await expect(takeOverHeadedTask(pool, { ...validInput, ...change })).rejects.toMatchObject({ statusCode: 400 });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('占用中的真实事务闸返回冲突，并回滚及释放自己的连接', async () => {
    const db = {
      query: vi.fn().mockImplementation(async sql => ({ rows: sql.includes('pg_try_advisory') ? [{ acquired: false }] : [] })),
      release: vi.fn(),
    };
    await expect(takeOverHeadedTask({ connect: vi.fn().mockResolvedValue(db) }, validInput))
      .rejects.toMatchObject({ statusCode: 409, message: 'headed_task_owner_busy' });
    expect(db.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      expect.stringContaining('pg_try_advisory_xact_lock'), 'ROLLBACK',
    ]);
    expect(db.release).toHaveBeenCalledTimes(1);
  });
});

describe('提交后交接写入的独立所有权事务', () => {
  function fixture(authorized = 1) {
    const result = { rows: [{ id: taskId }], rowCount: 1 };
    const db = {
      query: vi.fn().mockImplementation(async sql => sql.includes('JOIN headed_task_takeovers') ? { rows: [], rowCount: authorized } : result),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(db), query: vi.fn().mockResolvedValue(result) };
    return { db, pool, result, wrapper: headedPostcommitPool(pool, owner) };
  }

  it('只为当前终态任务的真实handoff写入绑定原generation和session', async () => {
    const { db, pool, result, wrapper } = fixture();
    await expect(wrapper.query(handoffSql, [taskId, '{}'])).resolves.toBe(result);
    const calls = db.query.mock.calls;
    expect(calls[0][0]).toBe('BEGIN');
    expect(calls[1][0]).toContain("t.status IN ('completed','completed_no_pr')");
    expect(calls[1][1]).toEqual([taskId, owner.generation, owner.session_id]);
    expect(calls[2][1]).toEqual([owner.generation]);
    expect(calls[3]).toEqual([handoffSql, [taskId, '{}']]);
    expect(calls[4][0]).toBe('COMMIT');
    expect(pool.query).not.toHaveBeenCalled();
    expect(db.release).toHaveBeenCalledTimes(1);
  });

  it('终态、generation或session不匹配时不写交接，并回滚', async () => {
    const { db, wrapper } = fixture(0);
    await expect(wrapper.query(handoffSql, [taskId, '{}'])).rejects.toMatchObject({ statusCode: 409 });
    expect(db.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', expect.stringContaining('JOIN headed_task_takeovers'), 'ROLLBACK']);
    expect(db.release).toHaveBeenCalledTimes(1);
  });

  it('handoff写失败不提交授权事务，仍释放连接', async () => {
    const { db, wrapper } = fixture();
    const error = new Error('fixture handoff write failed');
    db.query.mockImplementation(async sql => {
      if (sql === handoffSql) throw error;
      return { rows: [], rowCount: 1 };
    });
    await expect(wrapper.query(handoffSql, [taskId, '{}'])).rejects.toBe(error);
    expect(db.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(db.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
    expect(db.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['SELECT id FROM tasks WHERE id=$1', [taskId]],
    ['UPDATE tasks SET title=$2 WHERE id=$1', [taskId, 'metadata']],
    [handoffSql, ['d892fb70-fc20-4a66-8031-61cf28c537b5', '{}']],
  ])('普通查询及其他任务不借用原任务授权', async (sql, params) => {
    const { pool, wrapper } = fixture();
    await wrapper.query(sql, params);
    expect(pool.query).toHaveBeenCalledWith(sql, params);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
