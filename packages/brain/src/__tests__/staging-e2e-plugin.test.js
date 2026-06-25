/**
 * staging-e2e-plugin.test.js — 阶段2 Slice1 plugin 单元测试
 *
 * 覆盖：节流门、无任务短路、claim+执行+标终态、handler 异常兜底。
 */
import { describe, it, expect, vi } from 'vitest';
import { tick, claimStagingE2eTask } from '../staging-e2e-plugin.js';

function makePool(responses = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      const r = responses[i++];
      if (typeof r === 'function') return r(sql, params);
      return r || { rows: [] };
    }),
  };
}

describe('tick — 节流门', () => {
  it('elapsed < interval → throttled，不查 DB', async () => {
    const pool = makePool();
    const tickState = { lastStagingE2eTime: Date.now() };
    const r = await tick({ pool, tickState, intervalMs: 60000 });
    expect(r).toEqual({ skipped: true, reason: 'throttled' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('缺 tickState → 抛错', async () => {
    await expect(tick({ pool: makePool() })).rejects.toThrow(/tickState required/);
  });
});

describe('tick — claim 与执行', () => {
  it('无可执行任务 → no_task', async () => {
    const pool = makePool([{ rows: [] }]); // claim 返回空
    const tickState = { lastStagingE2eTime: 0 };
    const r = await tick({ pool, tickState, intervalMs: 0, handler: vi.fn() });
    expect(r).toEqual({ skipped: true, reason: 'no_task' });
  });

  it('claim 到任务 → 跑 handler → 标 completed + 写 result', async () => {
    const claimed = { id: 'task-1', title: 't', payload: { initiative_id: 'init-1' } };
    const pool = makePool([
      { rows: [claimed] },  // claim
      { rows: [] },         // UPDATE completed
    ]);
    const tickState = { lastStagingE2eTime: 0 };
    const handler = vi.fn(async () => ({ verdict: 'PASS', reason: null, resultId: 'res-1' }));
    const r = await tick({ pool, tickState, intervalMs: 0, handler });

    expect(handler).toHaveBeenCalledWith(claimed, { pool });
    expect(r).toMatchObject({ ran: true, taskId: 'task-1', verdict: 'PASS' });

    const upd = pool.calls[1];
    expect(upd.sql).toMatch(/status = 'completed'/);
    const result = JSON.parse(upd.params[1]);
    expect(result.verdict).toBe('PASS');
    expect(result.staging_e2e_result_id).toBe('res-1');
  });

  it('handler 抛错 → 兜底 verdict=ERROR，任务仍标 completed', async () => {
    const claimed = { id: 'task-2', title: 't', payload: {} };
    const pool = makePool([
      { rows: [claimed] },
      { rows: [] },
    ]);
    const tickState = { lastStagingE2eTime: 0 };
    const handler = vi.fn(async () => { throw new Error('kaboom'); });
    const r = await tick({ pool, tickState, intervalMs: 0, handler });
    expect(r.verdict).toBe('FAIL');
    const result = JSON.parse(pool.calls[1].params[1]);
    expect(result.verdict).toBe('FAIL');
    expect(result.reason).toBe('handler_throw');
  });

  it('DB 异常 → 返回 error，不抛', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('db gone'); }) };
    const tickState = { lastStagingE2eTime: 0 };
    const r = await tick({ pool, tickState, intervalMs: 0, handler: vi.fn() });
    expect(r.error).toBe('db gone');
  });
});

describe('claimStagingE2eTask', () => {
  it('用 FOR UPDATE SKIP LOCKED 原子 claim', async () => {
    const pool = makePool([{ rows: [{ id: 'task-1', title: 't', payload: {} }] }]);
    const t = await claimStagingE2eTask(pool);
    expect(t.id).toBe('task-1');
    expect(pool.calls[0].sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(pool.calls[0].sql).toMatch(/task_type = 'staging_e2e'/);
  });
});
