// packages/brain/src/__tests__/reanchor-blocked-tasks-script.test.js
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../task-updater.js', () => ({
  unblockTask: vi.fn(),
}));

import { unblockTask } from '../task-updater.js';
import { reanchorBlockedTasks } from '../../scripts/reanchor-blocked-tasks.mjs';

function candidateRow(overrides = {}) {
  return {
    id: 'task-1',
    title: '示例任务',
    blocked_detail: { reason_code: 'map_revision_mismatch' },
    ...overrides,
  };
}

function makeDb(rows) {
  return {
    query: vi.fn(async sql => {
      if (/SELECT id, title, blocked_detail/.test(sql)) {
        return { rows };
      }
      if (/UPDATE tasks/.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
  };
}

describe('scripts/reanchor-blocked-tasks.mjs', () => {
  beforeEach(() => {
    unblockTask.mockReset();
  });

  it('只选 map_revision_mismatch 停车任务（三种 detail 形态），解锁前清零计数，支持 --dry-run', async () => {
    const source = await readFile(new URL('../../scripts/reanchor-blocked-tasks.mjs', import.meta.url), 'utf8');
    expect(source).toContain("blocked_reason = 'dispatch_fail_autoblock'");
    expect(source).toContain("blocked_detail->>'reason_code' = 'map_revision_mismatch'");
    expect(source).toContain("blocked_detail->>'last_error' = 'map_revision_mismatch'");
    expect(source).toContain("blocked_detail->>'message' LIKE '%base_sha 落后%'");
    expect(source).toContain('dispatch_fail_consecutive');
    expect(source).toContain('unblockTask(');
    expect(source).toContain("'--dry-run'");
  });

  it('dry-run 只发 SELECT，零 UPDATE，不调用 unblockTask，返回候选数', async () => {
    const rows = [
      candidateRow({ id: 'task-1' }),
      candidateRow({ id: 'task-2', blocked_detail: { message: '任务 x base_sha 落后地图 y' } }),
    ];
    const db = makeDb(rows);

    const result = await reanchorBlockedTasks({ db, dryRun: true, log: vi.fn() });

    expect(result.candidates).toBe(2);
    expect(result.done).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.task_ids).toEqual(['task-1', 'task-2']);
    expect(unblockTask).not.toHaveBeenCalled();
    const updateCalls = db.query.mock.calls.filter(([sql]) => /UPDATE tasks/.test(sql));
    expect(updateCalls).toHaveLength(0);
    const selectCalls = db.query.mock.calls.filter(([sql]) => /SELECT id, title, blocked_detail/.test(sql));
    expect(selectCalls).toHaveLength(1);
  });

  it('非 dry-run 两条候选，unblockTask 一成一败，UPDATE metadata 各发一次且先于 unblock', async () => {
    const rows = [
      candidateRow({ id: 'task-1', blocked_detail: { reason_code: 'map_revision_mismatch' } }),
      candidateRow({ id: 'task-2', blocked_detail: { last_error: 'map_revision_mismatch' } }),
    ];
    const db = makeDb(rows);
    const callOrder = [];
    db.query.mockImplementation(async sql => {
      if (/SELECT id, title, blocked_detail/.test(sql)) return { rows };
      if (/UPDATE tasks/.test(sql)) {
        callOrder.push('update');
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });
    unblockTask
      .mockImplementationOnce(async () => {
        callOrder.push('unblock');
        return { success: true, task: { id: 'task-1' } };
      })
      .mockImplementationOnce(async () => {
        callOrder.push('unblock');
        return { success: false, error: 'not blocked' };
      });

    const result = await reanchorBlockedTasks({ db, dryRun: false, log: vi.fn() });

    expect(result.candidates).toBe(2);
    expect(result.done).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.task_ids).toEqual(['task-1', 'task-2']);
    expect(unblockTask).toHaveBeenCalledTimes(2);
    const updateCalls = db.query.mock.calls.filter(([sql]) => /UPDATE tasks/.test(sql));
    expect(updateCalls).toHaveLength(2);
    expect(callOrder).toEqual(['update', 'unblock', 'update', 'unblock']);
  });

  it('跑完调用一次 emit，payload 带 candidates/unblocked/failed/dry_run/task_ids', async () => {
    const rows = [candidateRow({ id: 'task-1' })];
    const db = makeDb(rows);
    unblockTask.mockResolvedValueOnce({ success: true, task: { id: 'task-1' } });
    const emit = vi.fn().mockResolvedValue();

    await reanchorBlockedTasks({ db, dryRun: false, log: vi.fn(), emit });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'backfill:reanchor_blocked_tasks',
      'reanchor-blocked-tasks',
      {
        candidates: 1,
        unblocked: 1,
        rebased: 0,
        failed: 0,
        dry_run: false,
        task_ids: ['task-1'],
        needs_rebase_ids: [],
      },
    );
  });

  // I2：分支已有 initiative_runs 的候选不能解锁——下 tick 预检必转 needs_rebase 并 raise P3，
  // 一次回填就是一场告警风暴。改为脚本里直接分流标 needs_rebase，不进解锁路径。
  it('候选已有 run（has_run）时不解锁，直接标 needs_rebase 并计入 rebased', async () => {
    const rows = [
      candidateRow({ id: 'task-1', has_run: false }),
      candidateRow({ id: 'task-2', has_run: true }),
    ];
    const db = makeDb(rows);
    unblockTask.mockResolvedValueOnce({ success: true, task: { id: 'task-1' } });

    const result = await reanchorBlockedTasks({ db, dryRun: false, log: vi.fn() });

    expect(result.candidates).toBe(2);
    expect(result.done).toBe(1);
    expect(result.rebased).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.needs_rebase_ids).toEqual(['task-2']);
    expect(unblockTask).toHaveBeenCalledTimes(1);
    expect(unblockTask).toHaveBeenCalledWith('task-1');

    const rebaseCalls = db.query.mock.calls.filter(([sql]) => /needs_rebase/.test(sql));
    expect(rebaseCalls).toHaveLength(1);
    expect(rebaseCalls[0][0]).toMatch(/UPDATE tasks[\s\S]*blocked_reason\s*=\s*'needs_rebase'/);
    expect(rebaseCalls[0][0]).toMatch(/status\s*=\s*'blocked'/);
    expect(rebaseCalls[0][1]).toEqual(['task-2']);
    // 清零 dispatch_fail_consecutive 只对真正要解锁的那条发
    const metadataCalls = db.query.mock.calls.filter(([sql]) => /dispatch_fail_consecutive/.test(sql));
    expect(metadataCalls).toHaveLength(1);
    expect(metadataCalls[0][1]).toEqual(['task-1']);
  });

  it('候选 SQL 派生 has_run 列（两个 EXISTS：current_task_id / initiative_id）', async () => {
    const source = await readFile(new URL('../../scripts/reanchor-blocked-tasks.mjs', import.meta.url), 'utf8');
    expect(source).toMatch(/EXISTS \(SELECT 1 FROM initiative_runs WHERE current_task_id = tasks\.id\)/);
    expect(source).toMatch(/EXISTS \(SELECT 1 FROM initiative_runs WHERE initiative_id = tasks\.id\)/);
    expect(source).toContain('AS has_run');
  });

  it('dry-run 给已有 run 的候选打 [needs_rebase] 标记，且不改库', async () => {
    const rows = [
      candidateRow({ id: 'task-1', has_run: false }),
      candidateRow({ id: 'task-2', has_run: true }),
    ];
    const db = makeDb(rows);
    const log = vi.fn();

    const result = await reanchorBlockedTasks({ db, dryRun: true, log });

    expect(result.rebased).toBe(1);
    expect(result.done).toBe(0);
    expect(result.needs_rebase_ids).toEqual(['task-2']);
    expect(unblockTask).not.toHaveBeenCalled();
    expect(db.query.mock.calls.filter(([sql]) => /UPDATE tasks/.test(sql))).toHaveLength(0);
    const printed = log.mock.calls.map(([line]) => String(line));
    expect(printed.some(line => line.includes('task-2') && line.includes('[needs_rebase]'))).toBe(true);
    expect(printed.some(line => line.includes('task-1') && line.includes('[needs_rebase]'))).toBe(false);
  });
});
