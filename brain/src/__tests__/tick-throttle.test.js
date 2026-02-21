/**
 * Tick Throttle Tests
 * Verifies that runTickSafe('loop') is throttled to once per TICK_INTERVAL_MINUTES,
 * while runTickSafe('manual') is never throttled.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runTickSafe, TICK_INTERVAL_MINUTES, _resetLastExecuteTime } from '../tick.js';

describe('tick throttle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLastExecuteTime(); // reset throttle state between tests
  });

  it('loop source: executes when no previous tick has run', async () => {
    const mockTick = vi.fn().mockResolvedValue({ actions_taken: [] });
    const result = await runTickSafe('loop', mockTick);
    // Should have executed (first run, no throttle)
    expect(result.skipped).not.toBe(true);
    expect(mockTick).toHaveBeenCalledTimes(1);
  });

  it('loop source: throttled within TICK_INTERVAL_MINUTES after first run', async () => {
    const mockTick = vi.fn().mockResolvedValue({ actions_taken: [] });
    // First call: should execute
    await runTickSafe('loop', mockTick);
    // Second call immediately after: should be throttled
    const result = await runTickSafe('loop', mockTick);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('throttled');
    expect(mockTick).toHaveBeenCalledTimes(1);
  });

  it('manual source: never throttled even right after a loop tick', async () => {
    const mockTick = vi.fn().mockResolvedValue({ actions_taken: [] });
    // First loop call: executes
    await runTickSafe('loop', mockTick);
    // Manual call immediately after: must not be throttled
    const result = await runTickSafe('manual', mockTick);
    expect(result.skipped).not.toBe(true);
    expect(mockTick).toHaveBeenCalledTimes(2);
  });

  it('throttled response includes next_in_ms', async () => {
    const mockTick = vi.fn().mockResolvedValue({ actions_taken: [] });
    await runTickSafe('loop', mockTick);
    const result = await runTickSafe('loop', mockTick);
    expect(result.skipped).toBe(true);
    expect(typeof result.next_in_ms).toBe('number');
    expect(result.next_in_ms).toBeGreaterThan(0);
    expect(result.next_in_ms).toBeLessThanOrEqual(TICK_INTERVAL_MINUTES * 60 * 1000);
  });
});
