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

describe('Bug 1: Check 7 creates task with decomposition=continue (not true)', () => {
  let pool;
  let checkExploratoryDecompositionContinue;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const dbModule = await import('../db.js');
    pool = dbModule.default;
    const checker = await import('../decomposition-checker.js');
    checkExploratoryDecompositionContinue = checker.checkExploratoryDecompositionContinue;
  });

  it('stores decomposition=continue in payload so NOT EXISTS dedup can find it', async () => {
    const expTaskId = 'exp-dedup-001';

    // Check 7 SELECT: returns 1 exploratory task with next_action=decompose
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: expTaskId,
        title: '探索: 分析调度瓶颈',
        project_id: 'proj-001',
        goal_id: 'kr-001',
        payload: { next_action: 'decompose', findings: '发现瓶颈' }
      }]
    });

    // createDecompositionTask INSERT → capture the payload argument
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'cont-task-001', title: '探索续拆: 探索: 分析调度瓶颈' }]
    });

    await checkExploratoryDecompositionContinue();

    // Find the INSERT call (second pool.query call)
    const insertCall = pool.query.mock.calls[1];
    expect(insertCall).toBeDefined();

    // The 5th argument ($5) is the payload JSON
    const payloadArg = insertCall[1][4]; // values array index 4 = $5
    const payload = JSON.parse(payloadArg);

    // CRITICAL: payload must have decomposition='continue', not 'true'
    // This allows the NOT EXISTS subquery to match: payload->>'decomposition' = 'continue'
    expect(payload.decomposition).toBe('continue');
    expect(payload.level).toBe('exploratory_continue');
    expect(payload.exploratory_source).toBe(expTaskId);
  });

  it('NOT EXISTS dedup: second call for same exploratory task returns no actions', async () => {
    // Simulate NOT EXISTS working: SQL returns empty because existing task found
    pool.query.mockResolvedValueOnce({ rows: [] });

    const actions = await checkExploratoryDecompositionContinue();

    expect(actions.length).toBe(0);
  });

  it('decomposition value is continue, which differs from default true for other checks', async () => {
    // Verify the override: Check 7 payload { decomposition: 'continue', ... }
    // overrides the default { decomposition: 'true', ...payload } in createDecompositionTask()
    // Result: { decomposition: 'continue', level: 'exploratory_continue', ... }

    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'exp-002',
        title: '探索: 验证 API 性能',
        project_id: 'proj-002',
        goal_id: 'kr-002',
        payload: { next_action: 'decompose' }
      }]
    });
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'cont-002', title: '探索续拆: 探索: 验证 API 性能' }]
    });

    await checkExploratoryDecompositionContinue();

    const insertCall = pool.query.mock.calls[1];
    const payload = JSON.parse(insertCall[1][4]);

    // Must NOT be 'true' (the default) — must be 'continue' (the override)
    expect(payload.decomposition).not.toBe('true');
    expect(payload.decomposition).toBe('continue');
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
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-revert-001', status: 'queued' }]
    });

    const { updateTask } = await import('../actions.js');
    const result = await updateTask({ task_id: 'task-revert-001', status: 'queued' });

    // Revert must succeed (no atomic guard blocks revert)
    expect(result.success).toBe(true);
    expect(result.task.status).toBe('queued');
  });

  it('tick.js no-executor path must NOT return dispatched:true (code review)', async () => {
    // Verify the fix: tick.js checkCeceliaRunAvailable block now returns dispatched:false
    // The old code returned { dispatched: true, reason: 'no_executor' } which was wrong
    // The new code returns { dispatched: false, reason: 'no_executor' } after revert
    //
    // Since dispatchNextTask has many complex dependencies, we verify by reading the
    // tick.js source to confirm the fix is in place.
    // This is a snapshot test of the intended behavior.
    const fs = await import('fs');
    const source = fs.default.readFileSync(
      new URL('../tick.js', import.meta.url).pathname, 'utf8'
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
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-001', status: 'in_progress' }]
    });

    const { updateTask } = await import('../actions.js');
    await updateTask({ task_id: 'task-001', status: 'in_progress' });

    const queryCall = pool.query.mock.calls[0];
    const sql = queryCall[0];

    // Atomic guard must be present
    expect(sql).toContain("status = 'queued'");
  });

  it('updateTask with status=queued does NOT add the atomic guard (only for in_progress)', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-001', status: 'queued' }]
    });

    const { updateTask } = await import('../actions.js');
    await updateTask({ task_id: 'task-001', status: 'queued' });

    const queryCall = pool.query.mock.calls[0];
    const sql = queryCall[0];

    // Reverting to queued does NOT need the guard
    expect(sql).not.toContain("AND status = 'queued'");
  });

  it('returns error when task already dispatched (race condition protection)', async () => {
    // Simulate race: another process already dispatched → UPDATE returns 0 rows
    pool.query.mockResolvedValueOnce({ rows: [] });

    const { updateTask } = await import('../actions.js');
    const result = await updateTask({ task_id: 'task-race-001', status: 'in_progress' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already dispatched');
  });
});
