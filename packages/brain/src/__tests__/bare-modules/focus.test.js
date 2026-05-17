/**
 * Bare Module Test: focus.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

describe('focus module', () => {
  it('can be imported', async () => {
    const mod = await import('../../focus.js');
    expect(mod).toBeDefined();
  });

  it('exports getDailyFocus function', async () => {
    const { getDailyFocus } = await import('../../focus.js');
    expect(typeof getDailyFocus).toBe('function');
  });

  it('exports setDailyFocus function', async () => {
    const { setDailyFocus } = await import('../../focus.js');
    expect(typeof setDailyFocus).toBe('function');
  });

  it('exports clearDailyFocus function', async () => {
    const { clearDailyFocus } = await import('../../focus.js');
    expect(typeof clearDailyFocus).toBe('function');
  });
});
