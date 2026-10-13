/**
 * Tests for Bug Fixes: dedup + dispatch reliability (PR post-v1.48.1)
 *
 * Bug 1: Check 7 payload missing decomposition:'continue' → NOT EXISTS dedup always fails → duplicate tasks
 * Bug 2: Task stuck in in_progress when no executor (cecelia-run unavailable)
 * Bug 3: updateTask lacks WHERE status='queued' atomic guard on dispatch
 * Bug 4: execution-callback lacks AND status='in_progress' idempotency guard
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1: Check 7 payload has decomposition: 'continue'
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));


function mockTaskMutation(pool, rows) {
  pool.query.mockImplementation(async sql => {
    if (/^\s*SELECT id, payload, result FROM tasks/.test(sql)) return { rows: [] };
    if (/^\s*SELECT \* FROM tasks/.test(sql)) return { rows };
    if (/^\s*UPDATE tasks/.test(sql)) return { rows, rowCount: rows.length };
    throw new Error(`unexpected test query: ${sql}`);
  });
}
function taskUpdateSql(pool) {
  const calls = pool.query.mock.calls.filter(([sql]) => /^\s*UPDATE tasks/.test(sql));
  expect(calls).toHaveLength(1);
  return calls[0][0];
}
/**
 * Bug 1: PLACEHOLDER
 * checkExploratoryDecompositionContinue (Check 7) 已从 decomposition-checker.js 删除
 * 原 Bug 1 测试（dedup payload=continue）随函数一同移除
 */
describe('Bug 1 (removed): Check 7 / checkExploratoryDecompositionContinue removed', () => {
  it('placeholder: Check 7 removed with exploratory concept', () => {
    // checkExploratoryDecompositionContinue 已删除，不再需要测试
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 2: Task revert to queued behavior - tested via updateTask
// The key fix: when executor unavailable, tick.js calls updateTask({status:'queued'})
// This test verifies that updateTask correctly reverts in_progress → queued
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug 2: Task can be reverted from in_progress to queued (revert behavior)', () => {
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const dbModule = await import('../db.js');
    pool = dbModule.default;
  });

  it('updateTask allows reverting in_progress back to queued (no atomic guard on revert)', async () => {
    mockTaskMutation(pool, [{ id: 'task-revert-001', status: 'queued' }]);

    const { updateTask } = await import('../actions.js');
    const result = await updateTask({ task_id: 'task-revert-001', status: 'queued' });

    // Revert must succeed (no atomic guard blocks revert)
    expect(result.success).toBe(true);
    expect(result.task.status).toBe('queued');
  });

  it('dispatcher.js no-executor path must NOT return dispatched:true (code review)', async () => {
    // Phase D Part 1.5: dispatchNextTask 已搬到 dispatcher.js，源码 grep 跟随迁移
    // Verify the fix: dispatchNextTask checkCeceliaRunAvailable block now returns dispatched:false
    // The old code returned { dispatched: true, reason: 'no_executor' } which was wrong
    // The new code returns { dispatched: false, reason: 'no_executor' } after revert
    const fs = await import('fs');
    const source = fs.default.readFileSync(
      new URL('../dispatcher.js', import.meta.url).pathname, 'utf8'
    );
    // Old bug: returned dispatched: true when no executor
    // New fix: returns dispatched: false after reverting task to queued
    expect(source).toContain('return { dispatched: false, reason: \'no_executor\'');
    // New fix: also reverts the task status
    expect(source).toContain('task reverted to queued');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 3: updateTask atomic guard - only transitions from queued to in_progress
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug 3: updateTask WHERE status=queued guard on in_progress transition', () => {
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const dbModule = await import('../db.js');
    pool = dbModule.default;
  });

  it('updateTask with status=in_progress uses AND status=queued in WHERE clause', async () => {
    mockTaskMutation(pool, [{ id: 'task-001', status: 'in_progress' }]);

    const { updateTask } = await import('../actions.js');
    await updateTask({ task_id: 'task-001', status: 'in_progress' });

    const sql = taskUpdateSql(pool);

    // Atomic guard must be present
    expect(sql).toContain("status = 'queued'");
  });

  it('updateTask with status=queued does NOT add the atomic guard (only for in_progress)', async () => {
    mockTaskMutation(pool, [{ id: 'task-001', status: 'queued' }]);

    const { updateTask } = await import('../actions.js');
    await updateTask({ task_id: 'task-001', status: 'queued' });

    const sql = taskUpdateSql(pool);

    // Reverting to queued does NOT need the guard
    expect(sql).not.toContain("AND status = 'queued'");
  });

  it('returns error when task already dispatched (race condition protection)', async () => {
    // Simulate race: another process already dispatched → UPDATE returns 0 rows
    mockTaskMutation(pool, []);

    const { updateTask } = await import('../actions.js');
    const result = await updateTask({ task_id: 'task-race-001', status: 'in_progress' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already dispatched');
  });
});
