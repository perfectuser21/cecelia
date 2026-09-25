/**
 * owner-decision-deadline sweeper 的有界性与隔离（链 bf5088a3 棒 9，任务 8aa79219）。
 * 真库下「可逆走默认 / 不可逆顺延 / 幂等」见 integration/owner-decision-approval.pg.integration.test.js；
 * 这里用假 pool 验真库测不出的：整轮预算、连接超时、单任务失败隔离、Bark 失败不影响已提交结果、SQL 超时参数。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const applyMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/owner-decision-resolve.js', async (importOriginal) => ({
  ...(await importOriginal()),
  applyOwnerDecisionResolution: (...a) => applyMock(...a),
}));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));

import { runOwnerDecisionDeadline, __resetOwnerDecisionDeadlineForTest } from '../owner-decision-deadline.js';

const detail = (over = {}) => ({
  question: '要不要摘掉？',
  options: ['A: 摘', 'B: 留'],
  default: 'B',
  deadline: '2020-01-01T00:00:00Z',
  reversible: true,
  waiting_on: 'human',
  ...over,
});

const candidate = (id, over = {}) => ({ id, title: `t-${id}`, blocked_detail: detail(over), blocked_until: '2020-01-01T00:00:00Z' });

/** 假 pool：第一条 query 返回候选；连接的 client 按 SQL 分派，锁行复核返回仍到期的 blocked 任务。 */
function makePool(rows, { connect } = {}) {
  const sql = [];
  const client = {
    release: vi.fn(),
    query: vi.fn(async (text) => {
      sql.push(String(text).replace(/\s+/g, ' ').trim());
      if (/FROM tasks WHERE id = \$1 FOR UPDATE/.test(text)) {
        const id = client.__lastId;
        const r = rows.find((x) => x.id === id) ?? rows[0];
        return { rows: [{ ...r, status: 'blocked', blocked_reason: 'owner_decision', payload: {} }] };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  // 复核 SELECT 的 id 参数
  const origQuery = client.query;
  client.query = vi.fn(async (text, params) => {
    if (/FROM tasks WHERE id = \$1 FOR UPDATE/.test(text)) client.__lastId = params[0];
    return origQuery(text, params);
  });
  const pool = {
    query: vi.fn().mockResolvedValue({ rows }),
    connect: connect ?? vi.fn().mockResolvedValue(client),
  };
  return { pool, client, sql };
}

beforeEach(() => {
  applyMock.mockReset();
  applyMock.mockResolvedValue({ resolution: { choice: 'B', chosen_option: 'B: 留', by: 'system', via: 'default_on_deadline' } });
  __resetOwnerDecisionDeadlineForTest();
});
afterEach(() => vi.useRealTimers());

describe('runOwnerDecisionDeadline 有界与隔离', () => {
  it('候选查询带 query_timeout，并在 SQL 里预筛 waiting_on=human / 未驳回 / blocked_until 已到', async () => {
    const { pool } = makePool([]);
    await runOwnerDecisionDeadline(pool, { force: true, bark: vi.fn() });
    const arg = pool.query.mock.calls[0][0];
    expect(arg.query_timeout).toBeGreaterThan(0);
    expect(arg.text).toMatch(/waiting_on'\s*=\s*'human'/);
    expect(arg.text).toMatch(/blocked_until IS NULL OR blocked_until < NOW\(\)/);
    expect(arg.text).toMatch(/<>\s*'reject'/);
    expect(arg.text).toMatch(/LIMIT \$1/);
  });

  it('每个任务独立事务：先 BEGIN 再 SET LOCAL 语句/锁超时，行锁复核后才动手，最后 COMMIT', async () => {
    const { pool, sql } = makePool([candidate('t1')]);
    const r = await runOwnerDecisionDeadline(pool, { force: true, bark: vi.fn().mockResolvedValue(true) });
    expect(r.applied).toBe(1);
    const iBegin = sql.indexOf('BEGIN');
    const iStmt = sql.findIndex((s) => /SET LOCAL statement_timeout/.test(s));
    const iLock = sql.findIndex((s) => /SET LOCAL lock_timeout/.test(s));
    const iSelect = sql.findIndex((s) => /FOR UPDATE/.test(s));
    const iCommit = sql.indexOf('COMMIT');
    expect(iBegin).toBeGreaterThanOrEqual(0);
    expect(iBegin).toBeLessThan(iStmt);
    expect(iStmt).toBeLessThan(iSelect);
    expect(iLock).toBeLessThan(iSelect);
    expect(iSelect).toBeLessThan(iCommit);
  });

  it('整轮预算耗尽即停，不再开新事务（下一轮续）', async () => {
    const { pool } = makePool([candidate('t1'), candidate('t2')]);
    const r = await runOwnerDecisionDeadline(pool, { force: true, bark: vi.fn(), budgetMs: -1 });
    expect(r.budgetExceeded).toBe(true);
    expect(r.applied).toBe(0);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('单任务失败隔离：第一条应用抛错 → ROLLBACK 并记 failed，第二条照常处理', async () => {
    const { pool, client, sql } = makePool([candidate('t1'), candidate('t2')]);
    applyMock.mockRejectedValueOnce(new Error('unblock 被硬依赖拦住'));
    const r = await runOwnerDecisionDeadline(pool, { force: true, bark: vi.fn().mockResolvedValue(true) });
    expect(r.failed).toBe(1);
    expect(r.applied).toBe(1);
    expect(sql).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(2); // 失败也必须还连接
  });

  it('Bark 抛错/超时不影响已提交的结果（仍记 applied）', async () => {
    const { pool } = makePool([candidate('t1')]);
    const r = await runOwnerDecisionDeadline(pool, { force: true, bark: vi.fn().mockRejectedValue(new Error('bark down')) });
    expect(r.applied).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('取连接卡住：10s 超时后记 failed 且不挂死整轮；超时后才拿到的连接被归还', async () => {
    vi.useFakeTimers();
    let resolveConnect;
    const late = new Promise((res) => { resolveConnect = res; });
    const { pool, client } = makePool([candidate('t1')], { connect: vi.fn(() => late) });
    const p = runOwnerDecisionDeadline(pool, { force: true, bark: vi.fn() });
    await vi.advanceTimersByTimeAsync(10_001);
    const r = await p;
    expect(r.failed).toBe(1);
    resolveConnect(client);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.release).toHaveBeenCalled();
  });

  it('自 gate：未 force 时 10 分钟内第二次直接 skipped，不查库', async () => {
    const { pool } = makePool([]);
    await runOwnerDecisionDeadline(pool, { bark: vi.fn() });
    pool.query.mockClear();
    const second = await runOwnerDecisionDeadline(pool, { bark: vi.fn() });
    expect(second.skipped).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('deadline 不可解析的候选不处理（不因脏数据误执行默认）', async () => {
    const { pool } = makePool([candidate('t1', { deadline: '下周吧' })]);
    const r = await runOwnerDecisionDeadline(pool, { force: true, bark: vi.fn() });
    expect(r.notDue).toBe(1);
    expect(applyMock).not.toHaveBeenCalled();
  });
});
