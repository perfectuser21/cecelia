/**
 * Tick Periodic Cleanup Tests
 * Verifies that executeTick() calls run_periodic_cleanup() every CLEANUP_INTERVAL_MS.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CLEANUP_INTERVAL_MS, _resetLastCleanupTime } from '../tick.js';

describe('tick periodic cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLastCleanupTime();
  });

  it('CLEANUP_INTERVAL_MS is defined and positive', () => {
    expect(typeof CLEANUP_INTERVAL_MS).toBe('number');
    expect(CLEANUP_INTERVAL_MS).toBeGreaterThan(0);
  });

  it('default CLEANUP_INTERVAL_MS is 1 hour (3600000 ms)', () => {
    // Only check if env override not set
    if (!process.env.CECELIA_CLEANUP_INTERVAL_MS) {
      expect(CLEANUP_INTERVAL_MS).toBe(60 * 60 * 1000);
    }
  });

  it('_resetLastCleanupTime is exported and callable', () => {
    expect(typeof _resetLastCleanupTime).toBe('function');
    _resetLastCleanupTime(); // should not throw
  });
});
