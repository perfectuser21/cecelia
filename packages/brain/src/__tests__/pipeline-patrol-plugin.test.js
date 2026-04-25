/**
 * pipeline-patrol-plugin.test.js — D1.7c plugin 单测
 *
 * 验证：
 * 1. 节流门：elapsed < interval → skipped + tickState 不变
 * 2. 节流门：elapsed >= interval → 执行 runPipelinePatrol + tickState 更新
 * 3. tickLog 在 stuck>0 / rescued>0 时被调
 * 4. tickLog 在 stuck=0 + rescued=0 时不被调
 * 5. runPipelinePatrol 抛错 → 返回 { error }，不冒泡
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../pipeline-patrol.js', () => ({
  runPipelinePatrol: vi.fn(),
}));

import { runPipelinePatrol } from '../pipeline-patrol.js';
const { tick } = await import('../pipeline-patrol-plugin.js');

function makeTickState(last = 0) {
  return { lastPipelinePatrolTime: last };
}

describe('pipeline-patrol-plugin', () => {
  beforeEach(() => {
    runPipelinePatrol.mockReset();
  });

  it('elapsed < interval → skipped, runPipelinePatrol 不被调', async () => {
    const ts = makeTickState(Date.now() - 1000); // 1s 前
    const r = await tick({ pool: {}, tickState: ts, intervalMs: 60_000 });
    expect(r).toEqual({ skipped: true, reason: 'throttled' });
    expect(runPipelinePatrol).not.toHaveBeenCalled();
  });

  it('elapsed >= interval → 执行 runPipelinePatrol + tickState 更新', async () => {
    runPipelinePatrol.mockResolvedValueOnce({ scanned: 10, stuck: 2, rescued: 1 });
    const ts = makeTickState(0);
    const before = Date.now();
    const r = await tick({ pool: {}, tickState: ts, intervalMs: 1000 });
    expect(r.stuck).toBe(2);
    expect(r.rescued).toBe(1);
    expect(ts.lastPipelinePatrolTime).toBeGreaterThanOrEqual(before);
    expect(runPipelinePatrol).toHaveBeenCalledTimes(1);
  });

  it('stuck>0 → tickLog 被调', async () => {
    runPipelinePatrol.mockResolvedValueOnce({ scanned: 5, stuck: 1, rescued: 0 });
    const tickLog = vi.fn();
    await tick({ pool: {}, tickState: makeTickState(0), tickLog, intervalMs: 0 });
    expect(tickLog).toHaveBeenCalledWith(
      expect.stringContaining('Pipeline patrol: scanned=5 stuck=1 rescued=0')
    );
  });

  it('stuck=0 + rescued=0 → tickLog 不被调（静默）', async () => {
    runPipelinePatrol.mockResolvedValueOnce({ scanned: 3, stuck: 0, rescued: 0 });
    const tickLog = vi.fn();
    await tick({ pool: {}, tickState: makeTickState(0), tickLog, intervalMs: 0 });
    expect(tickLog).not.toHaveBeenCalled();
  });

  it('runPipelinePatrol 抛错 → 返回 error，不冒泡', async () => {
    runPipelinePatrol.mockRejectedValueOnce(new Error('boom'));
    const r = await tick({ pool: {}, tickState: makeTickState(0), intervalMs: 0 });
    expect(r.error).toBe('boom');
  });

  it('tickState 缺失抛错', async () => {
    await expect(tick({ pool: {} })).rejects.toThrow(/tickState required/);
  });
});
