/**
 * pipeline-watchdog-plugin.test.js — D1.7c plugin 单测
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../pipeline-watchdog.js', () => ({
  checkStuckPipelines: vi.fn(),
}));

import { checkStuckPipelines } from '../pipeline-watchdog.js';
const { tick } = await import('../pipeline-watchdog-plugin.js');

function makeTickState(last = 0) {
  return { lastPipelineWatchdogTime: last };
}

describe('pipeline-watchdog-plugin', () => {
  beforeEach(() => {
    checkStuckPipelines.mockReset();
  });

  it('MINIMAL_MODE → skipped, checkStuckPipelines 不被调', async () => {
    const r = await tick({
      pool: {},
      tickState: makeTickState(0),
      MINIMAL_MODE: true,
      intervalMs: 0,
    });
    expect(r).toEqual({ skipped: true, reason: 'minimal_mode' });
    expect(checkStuckPipelines).not.toHaveBeenCalled();
  });

  it('throttled → skipped', async () => {
    const ts = makeTickState(Date.now() - 1000);
    const r = await tick({ pool: {}, tickState: ts, intervalMs: 60_000 });
    expect(r).toEqual({ skipped: true, reason: 'throttled' });
    expect(checkStuckPipelines).not.toHaveBeenCalled();
  });

  it('elapsed >= interval → checkStuckPipelines 被调 + tickState 更新', async () => {
    checkStuckPipelines.mockResolvedValueOnce({ scanned: 4, stuck: 1, pipelines: [] });
    const ts = makeTickState(0);
    const before = Date.now();
    const r = await tick({ pool: {}, tickState: ts, intervalMs: 0 });
    expect(r.stuck).toBe(1);
    expect(ts.lastPipelineWatchdogTime).toBeGreaterThanOrEqual(before);
  });

  it('stuck>0 → tickLog 被调', async () => {
    checkStuckPipelines.mockResolvedValueOnce({ scanned: 3, stuck: 1 });
    const tickLog = vi.fn();
    await tick({ pool: {}, tickState: makeTickState(0), tickLog, intervalMs: 0 });
    expect(tickLog).toHaveBeenCalledWith(
      expect.stringContaining('Pipeline watchdog: scanned=3 stuck=1')
    );
  });

  it('stuck=0 → tickLog 不被调', async () => {
    checkStuckPipelines.mockResolvedValueOnce({ scanned: 3, stuck: 0 });
    const tickLog = vi.fn();
    await tick({ pool: {}, tickState: makeTickState(0), tickLog, intervalMs: 0 });
    expect(tickLog).not.toHaveBeenCalled();
  });

  it('checkStuckPipelines 抛错 → 返回 { error } 不冒泡', async () => {
    checkStuckPipelines.mockRejectedValueOnce(new Error('db down'));
    const r = await tick({ pool: {}, tickState: makeTickState(0), intervalMs: 0 });
    expect(r.error).toBe('db down');
  });
});
