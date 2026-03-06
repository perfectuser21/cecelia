/**
 * Bare Module Test: nightly-tick.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

describe('nightly-tick module', () => {
  it('can be imported', async () => {
    const mod = await import('../../nightly-tick.js');
    expect(mod).toBeDefined();
  });

  it('exports executeNightlyAlignment function', async () => {
    const { executeNightlyAlignment } = await import('../../nightly-tick.js');
    expect(typeof executeNightlyAlignment).toBe('function');
  });

  it('exports runNightlyAlignmentSafe function', async () => {
    const { runNightlyAlignmentSafe } = await import('../../nightly-tick.js');
    expect(typeof runNightlyAlignmentSafe).toBe('function');
  });

  it('exports startNightlyScheduler function', async () => {
    const { startNightlyScheduler } = await import('../../nightly-tick.js');
    expect(typeof startNightlyScheduler).toBe('function');
  });
});
