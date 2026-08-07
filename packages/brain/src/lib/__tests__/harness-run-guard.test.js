/**
 * harness-run-guard 单测(TOP2 刀1 — task f4f28298)
 *
 * 本模块把"哪些 initiative_runs 行会挡住重新 spawn"收成唯一判据:
 * spawn 侧(harness-skill-relay.js)读它,收割侧(harness-orphan-guard.js)按同一判据清它。
 * 判据分叉正是 2026-08-07 三条 harness_initiative 全灭的死锁根因——
 * 收割器把 task 打回 queued 却不动 run,spawn-guard 按活跃 run 一路拒到 requeue 超限。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  findActiveRunBlockingSpawn,
  terminalizeRunsForTask,
  ORPHAN_RUN_FAILURE_REASON,
} from '../harness-run-guard.js';

const TASK_ID = 'aaaabbbb-0000-0000-0000-000000000000';

function recordingPool(rows = []) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      return { rows, rowCount: rows.length };
    }),
  };
}

describe('findActiveRunBlockingSpawn', () => {
  it('存在非终态且未过期的 run → 返回该行(spawn 应被拒)', async () => {
    const pool = recordingPool([{ id: 'run-1', phase: 'B_task_loop' }]);
    const run = await findActiveRunBlockingSpawn(pool, TASK_ID);
    expect(run).toEqual({ id: 'run-1', phase: 'B_task_loop' });
  });

  it('无活跃 run → 返回 null(spawn 放行)', async () => {
    const pool = recordingPool([]);
    expect(await findActiveRunBlockingSpawn(pool, TASK_ID)).toBeNull();
  });

  it('判据 = current_task_id + 非终态 phase + deadline 未过', async () => {
    const pool = recordingPool([]);
    await findActiveRunBlockingSpawn(pool, TASK_ID);
    const { sql, params } = pool.calls[0];
    expect(sql).toContain('current_task_id');
    expect(sql).toContain("phase NOT IN ('done','failed')");
    expect(sql).toContain('deadline_at > NOW()');
    expect(params).toEqual([TASK_ID]);
  });

  it('DB 报错 → fail-open 返回 null(DB 抽风不能挡住正常调度)', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('pg down'); }) };
    expect(await findActiveRunBlockingSpawn(pool, TASK_ID)).toBeNull();
  });
});

describe('terminalizeRunsForTask', () => {
  it('把该 task 名下所有非终态 run 打成 failed 并写 failure_reason', async () => {
    const pool = recordingPool([{ id: 'run-1' }]);
    const r = await terminalizeRunsForTask(pool, TASK_ID, ORPHAN_RUN_FAILURE_REASON);
    expect(r.ok).toBe(true);
    expect(r.terminalized).toBe(1);
    const { sql, params } = pool.calls[0];
    expect(sql).toContain('UPDATE initiative_runs');
    expect(sql).toContain("phase = 'failed'");
    expect(sql).toContain('failure_reason');
    expect(sql).toContain('completed_at');
    // 条件守卫:只动非终态行,绝不覆盖已 done 的成功记录
    expect(sql).toContain("phase NOT IN ('done','failed')");
    expect(params).toEqual([TASK_ID, ORPHAN_RUN_FAILURE_REASON]);
  });

  it('没有非终态 run → terminalized=0,不报错', async () => {
    const pool = recordingPool([]);
    expect((await terminalizeRunsForTask(pool, TASK_ID, 'x')).terminalized).toBe(0);
  });

  it('DB 报错 → 不抛,返回 ok=false(收割主流程不能被它拖死)', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('pg down'); }) };
    const r = await terminalizeRunsForTask(pool, TASK_ID, 'x');
    expect(r.ok).toBe(false);
    expect(r.terminalized).toBe(0);
  });
});
