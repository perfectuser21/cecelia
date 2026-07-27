import { describe, it, expect } from 'vitest';

describe('Kernel attempt status SSOT contract', () => {
  it('attempt 状态 SSOT：active 仅 queued starting running，terminal 仅 completed completed_with_concerns needs_context blocked failed cancelled', async () => {
    const mod = await import('../../../packages/brain/src/orchestrator/execution-contract.js');

    expect(Array.isArray((mod as any).ACTIVE_ATTEMPT_STATUSES)).toBe(true);
    expect((mod as any).ACTIVE_ATTEMPT_STATUSES).toEqual(['queued', 'starting', 'running']);
    expect(Array.isArray((mod as any).TERMINAL_ATTEMPT_STATUSES)).toBe(true);
    expect((mod as any).TERMINAL_ATTEMPT_STATUSES).toEqual([
      'completed',
      'completed_with_concerns',
      'needs_context',
      'blocked',
      'failed',
      'cancelled',
    ]);
  });

  it('same attempt 非终态转 recovered terminal 只释放一次容量', async () => {
    const mod = await import('../../../packages/brain/src/orchestrator/execution-contract.js');

    expect(typeof (mod as any).releaseRecoveredAttemptCapacity).toBe('function');

    const first = (mod as any).releaseRecoveredAttemptCapacity({
      safe_limit: 4,
      occupied: 3,
      previous_status: 'running',
      next_status: 'failed',
      recovered: true,
    });
    expect(first).toMatchObject({ released: 1, occupied: 2, free: 2 });

    const second = (mod as any).releaseRecoveredAttemptCapacity({
      safe_limit: 4,
      occupied: first.occupied,
      previous_status: 'failed',
      next_status: 'failed',
      recovered: true,
    });
    expect(second).toMatchObject({ released: 0, occupied: 2, free: 2 });
  });
});
