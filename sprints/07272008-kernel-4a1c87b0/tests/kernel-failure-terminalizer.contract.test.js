import { describe, expect, it } from 'vitest';

const terminalizerModPromise = import('../../../packages/brain/src/orchestrator/failure-terminalizer.js').catch(() => ({}));
const reconcilerModPromise = import('../../../packages/brain/src/orchestrator/reconciler.js').catch(() => ({}));

describe('Kernel failure terminalizer contract', () => {
  it('统一失败出口接入 failure terminalizer', async () => {
    const mod = await terminalizerModPromise;
    expect(typeof mod.failureTerminalizer).toBe('function');
    expect(typeof mod.classifyFailureTerminalAction).toBe('function');
    const routes = mod.classifyFailureTerminalAction?.();
    expect(routes).toEqual(expect.objectContaining({
      hop_cap: 'failure_terminalizer',
      blocked_same_state: 'failure_terminalizer',
      ci_timeout: 'failure_terminalizer',
      approved_but_no_contract_sha: 'failure_terminalizer',
      fatal_catch: 'failure_terminalizer',
      launch_failure: 'failure_terminalizer',
      watchdog_deadline: 'failure_terminalizer',
    }));
  });

  it('infrastructure_blocked 仅前 3 次 requeue 第 4 次 hard fail', async () => {
    const mod = await terminalizerModPromise;
    expect(typeof mod.planFailureDisposition).toBe('function');
    const outcomes = [0, 1, 2, 3].map((retryCount) => mod.planFailureDisposition({
      failureClass: 'infrastructure_blocked',
      retryCount,
      currentTaskMatches: true,
      taskStatus: 'in_progress',
    }));
    expect(outcomes.slice(0, 3)).toEqual([
      expect.objectContaining({ action: 'requeue', next_retry_count: 1 }),
      expect.objectContaining({ action: 'requeue', next_retry_count: 2 }),
      expect.objectContaining({ action: 'requeue', next_retry_count: 3 }),
    ]);
    expect(outcomes[3]).toEqual(expect.objectContaining({ action: 'hard_fail' }));
    expect(mod.planFailureDisposition({
      failureClass: 'contract_invalid',
      retryCount: 0,
      currentTaskMatches: true,
      taskStatus: 'in_progress',
    })).toEqual(expect.objectContaining({ action: 'hard_fail' }));
  });

  it('reconciler 仅处理 latest kernel v2 terminal run 的精确幽灵态', async () => {
    const mod = await reconcilerModPromise;
    expect(typeof mod.findReconcilableKernelGhosts).toBe('function');
    const rows = mod.findReconcilableKernelGhosts?.([
      { run_id: 'latest-v2', orchestrator_version: 'v2', phase: 'failed', is_latest: true, current_task_matches: true, task_status: 'in_progress' },
      { run_id: 'old-v2', orchestrator_version: 'v2', phase: 'failed', is_latest: false, current_task_matches: true, task_status: 'in_progress' },
      { run_id: 'latest-v1', orchestrator_version: 'v1', phase: 'failed', is_latest: true, current_task_matches: true, task_status: 'in_progress' },
      { run_id: 'paused-task', orchestrator_version: 'v2', phase: 'failed', is_latest: true, current_task_matches: true, task_status: 'paused' },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ run_id: 'latest-v2' }),
    ]);
  });

  it('slot allocator 继续以 task status 为 SSOT 且 failed API 补 completed_at', async () => {
    const mod = await terminalizerModPromise;
    expect(typeof mod.assertSlotAllocatorContract).toBe('function');
    expect(mod.assertSlotAllocatorContract({
      slot_sql: `SELECT count(*)::int AS n
         FROM initiative_runs r
         JOIN tasks t ON t.id = r.current_task_id
        WHERE r.orchestrator_version = 'v2'
          AND r.phase NOT IN ('done','failed')
          AND t.status = 'in_progress'`,
      failedRouteSql: `UPDATE tasks SET status='failed', completed_at=NOW(), updated_at=NOW() WHERE id=$1 AND status='in_progress'`,
    })).toEqual(expect.objectContaining({
      task_status_is_ssot: true,
      failed_route_sets_completed_at: true,
    }));
  });
});
