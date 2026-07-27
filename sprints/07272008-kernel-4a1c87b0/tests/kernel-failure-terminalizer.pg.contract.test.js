import { describe, expect, it } from 'vitest';

const terminalizerModPromise = import('../../../packages/brain/src/orchestrator/failure-terminalizer.js').catch(() => ({}));

describe('Kernel failure terminalizer PG contract', () => {
  it('hard failure 原子终结 run task history claim 并保持幂等', async () => {
    const mod = await terminalizerModPromise;
    expect(typeof mod.createFailureTerminalizerHarness).toBe('function');
    const harness = await mod.createFailureTerminalizerHarness?.();
    expect(harness).toEqual(expect.objectContaining({
      uses_transaction: true,
      validates_current_task_id: true,
      validates_in_progress: true,
      writes_run_completed_at: true,
      writes_task_completed_at: true,
      clears_claim: true,
      status_history_mode: 'single_append',
      idempotent: true,
      rollback_on_error: true,
      supports_watchdog_deadline: true,
      supports_launch_failure: true,
    }));
  });
});
