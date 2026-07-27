import { describe, it, expect } from 'vitest';

describe('Kernel attempt status SSOT contract', () => {
  it('attempt 状态 SSOT：active 仅 queued starting running，terminal 仅 completed completed_with_concerns needs_context blocked failed cancelled', async () => {
    const execContract = await import('../../../packages/brain/src/orchestrator/execution-contract.js');
    const attemptStore = await import('../../../packages/brain/src/orchestrator/attempt-store.js');

    expect(Array.isArray((execContract as any).ACTIVE_ATTEMPT_STATUSES)).toBe(true);
    expect((execContract as any).ACTIVE_ATTEMPT_STATUSES).toEqual(['queued', 'starting', 'running']);
    expect(Array.isArray((execContract as any).TERMINAL_ATTEMPT_STATUSES)).toBe(true);
    expect((execContract as any).TERMINAL_ATTEMPT_STATUSES).toEqual([
      'completed',
      'completed_with_concerns',
      'needs_context',
      'blocked',
      'failed',
      'cancelled',
    ]);
    expect(typeof (attemptStore as any).isActiveAttemptStatus).toBe('function');
    expect(typeof (attemptStore as any).isTerminalAttemptStatus).toBe('function');
  });

  it('same attempt 非终态转 recovered terminal 只释放一次容量且重复 terminal 不二次释放', async () => {
    const execContract = await import('../../../packages/brain/src/orchestrator/execution-contract.js');

    expect(typeof (execContract as any).releaseRecoveredAttemptCapacity).toBe('function');

    const first = (execContract as any).releaseRecoveredAttemptCapacity({
      attempt_id: 'attempt-1',
      safe_limit: 4,
      occupied: 3,
      previous_status: 'running',
      next_status: 'failed',
      recovered: true,
    });
    expect(first).toMatchObject({ released: 1, occupied: 2, free: 2 });

    const second = (execContract as any).releaseRecoveredAttemptCapacity({
      attempt_id: 'attempt-1',
      safe_limit: 4,
      occupied: first.occupied,
      previous_status: 'failed',
      next_status: 'failed',
      recovered: true,
    });
    expect(second).toMatchObject({ released: 0, occupied: 2, free: 2 });
  });
});
