// Tests for condition-based-waiting.ts (generic waitFor helper).
// Verifies the 4 cases required by R2 PRD DoD.

import { describe, it, expect } from 'vitest';
import { waitFor } from '../utils/condition-based-waiting';

describe('waitFor', () => {
  it('resolves immediately when predicate is already true', async () => {
    const start = Date.now();
    await waitFor(() => true, { timeoutMs: 1000, intervalMs: 10 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(80);
  });

  it('resolves after ~100ms when predicate becomes true', async () => {
    const flipAt = Date.now() + 100;
    const start = Date.now();
    await waitFor(() => Date.now() >= flipAt, { timeoutMs: 2000, intervalMs: 10 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(95);
    expect(elapsed).toBeLessThan(400);
  });

  it('rejects with timeout error when predicate never becomes true', async () => {
    await expect(
      waitFor(() => false, { timeoutMs: 100, intervalMs: 10, description: 'never-true' })
    ).rejects.toThrow(/Timeout waiting for never-true after 100ms/);
  });

  it('propagates errors thrown by the predicate', async () => {
    await expect(
      waitFor(
        () => {
          throw new Error('boom');
        },
        { timeoutMs: 1000, intervalMs: 10 }
      )
    ).rejects.toThrow('boom');
  });
});
