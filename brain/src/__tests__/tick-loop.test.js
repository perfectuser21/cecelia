/**
 * Tick Loop Tests
 * Tests for tick auto-loop mechanism: reentry guard, timeout, start/stop
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startTickLoop,
  stopTickLoop,
  runTickSafe,
  getTickStatus,
  TICK_TIMEOUT_MS
} from '../tick.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stopTickLoop();
  vi.useRealTimers();
});

describe('Tick Loop - startTickLoop / stopTickLoop', () => {
  it('startTickLoop returns true on first call', () => {
    expect(startTickLoop()).toBe(true);
  });

  it('startTickLoop returns false if already running', () => {
    startTickLoop();
    expect(startTickLoop()).toBe(false);
  });

  it('stopTickLoop returns true when loop is running', () => {
    startTickLoop();
    expect(stopTickLoop()).toBe(true);
  });

  it('stopTickLoop returns false when no loop running', () => {
    expect(stopTickLoop()).toBe(false);
  });

  it('getTickStatus reports loop_running correctly', async () => {
    const s1 = await getTickStatus();
    expect(s1.loop_running).toBe(false);

    startTickLoop();
    const s2 = await getTickStatus();
    expect(s2.loop_running).toBe(true);

    stopTickLoop();
    const s3 = await getTickStatus();
    expect(s3.loop_running).toBe(false);
  });
});

describe('Tick Loop - runTickSafe reentry guard', () => {
  it('returns skipped when tick is already running', async () => {
    const slowTick = () => new Promise(resolve => {
      setTimeout(() => resolve({ success: true, actions_taken: [] }), 5000);
    });

    // Start first tick (don't await)
    const firstRun = runTickSafe('test-1', slowTick);

    // Immediately try second tick
    const secondRun = await runTickSafe('test-2', slowTick);

    expect(secondRun.skipped).toBe(true);
    expect(secondRun.reason).toBe('already_running');

    // Let first tick complete
    vi.advanceTimersByTime(5000);
    await firstRun;
  });

  it('releases lock after tick completes', async () => {
    const mockTick = vi.fn().mockResolvedValue({ success: true, actions_taken: [] });

    const r1 = await runTickSafe('test', mockTick);
    expect(r1.success).toBe(true);

    const r2 = await runTickSafe('test', mockTick);
    expect(r2.success).toBe(true);

    expect(mockTick).toHaveBeenCalledTimes(2);
  });

  it('releases lock on error', async () => {
    const failTick = vi.fn().mockRejectedValue(new Error('DB error'));
    const okTick = vi.fn().mockResolvedValue({ success: true, actions_taken: [] });

    const r1 = await runTickSafe('test', failTick);
    expect(r1.success).toBe(false);
    expect(r1.error).toBe('DB error');

    // Lock should be released
    const r2 = await runTickSafe('test', okTick);
    expect(r2.success).toBe(true);
  });
});

describe('Tick Loop - timeout protection', () => {
  it('force-releases lock after TICK_TIMEOUT_MS', async () => {
    const neverResolve = () => new Promise(() => {});
    const okTick = vi.fn().mockResolvedValue({ success: true, actions_taken: [] });

    // Start a tick that hangs
    runTickSafe('hanging', neverResolve);

    // Advance past timeout
    vi.advanceTimersByTime(TICK_TIMEOUT_MS + 1000);

    // Lock should be force-released
    const result = await runTickSafe('after-timeout', okTick);
    expect(result.skipped).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
