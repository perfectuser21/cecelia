/**
 * paused-requeuer-plugin.test.js — [ARTIFACT] tick.js 注册单测
 *
 * 验证：
 * 1. 节流门：elapsed < 5min → skipped，runPausedRequeue 不被调
 * 2. 节流门：elapsed >= interval → 执行 runPausedRequeue + tickState 更新
 * 3. tickLog 在 requeued>0 / archived>0 时被调
 * 4. tickLog 在全 0 时不被调（静默）
 * 5. runPausedRequeue 抛错 → 返回 { error }，不冒泡
 * 6. tickState 缺失 → 抛 paused-requeuer: tickState required
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../paused-requeuer.js', () => ({
  runPausedRequeue: vi.fn(),
  default: {},
}));

import { runPausedRequeue } from '../paused-requeuer.js';
const { tick } = await import('../paused-requeuer-plugin.js');

function makeTickState(last = 0) {
  return { lastPausedRequeuTime: last };
}

describe('paused-requeuer plugin — tick() 5min 周期节流', () => {
  beforeEach(() => {
    runPausedRequeue.mockReset();
  });

  it('elapsed < interval（5min）→ skipped，runPausedRequeue 不被调', async () => {
    const ts = makeTickState(Date.now() - 1000); // 1s 前
    const r = await tick({ pool: {}, tickState: ts, intervalMs: 5 * 60 * 1000 });
    expect(r).toEqual({ skipped: true, reason: 'throttled' });
    expect(runPausedRequeue).not.toHaveBeenCalled();
  });

  it('elapsed >= interval → 执行 runPausedRequeue + tickState.lastPausedRequeuTime 更新', async () => {
    runPausedRequeue.mockResolvedValueOnce({ requeued: 3, archived: 1 });
    const ts = makeTickState(0);
    const before = Date.now();
    const r = await tick({ pool: {}, tickState: ts, intervalMs: 1000 });
    expect(r.requeued).toBe(3);
    expect(r.archived).toBe(1);
    expect(ts.lastPausedRequeuTime).toBeGreaterThanOrEqual(before);
    expect(runPausedRequeue).toHaveBeenCalledTimes(1);
  });

  it('requeued>0 → tickLog 被调，含 requeued= archived= 信息', async () => {
    runPausedRequeue.mockResolvedValueOnce({ requeued: 5, archived: 0 });
    const tickLog = vi.fn();
    await tick({ pool: {}, tickState: makeTickState(0), tickLog, intervalMs: 0 });
    expect(tickLog).toHaveBeenCalledWith(
      expect.stringContaining('requeued=5')
    );
    expect(tickLog).toHaveBeenCalledWith(
      expect.stringContaining('archived=0')
    );
  });

  it('archived>0 → tickLog 被调', async () => {
    runPausedRequeue.mockResolvedValueOnce({ requeued: 0, archived: 2 });
    const tickLog = vi.fn();
    await tick({ pool: {}, tickState: makeTickState(0), tickLog, intervalMs: 0 });
    expect(tickLog).toHaveBeenCalledWith(
      expect.stringContaining('archived=2')
    );
  });

  it('requeued=0 + archived=0 → tickLog 不被调（静默）', async () => {
    runPausedRequeue.mockResolvedValueOnce({ requeued: 0, archived: 0 });
    const tickLog = vi.fn();
    await tick({ pool: {}, tickState: makeTickState(0), tickLog, intervalMs: 0 });
    expect(tickLog).not.toHaveBeenCalled();
  });

  it('runPausedRequeue 抛错 → 返回 { error }，不冒泡', async () => {
    runPausedRequeue.mockRejectedValueOnce(new Error('db timeout'));
    const r = await tick({ pool: {}, tickState: makeTickState(0), intervalMs: 0 });
    expect(r.error).toBe('db timeout');
  });

  it('tickState 缺失 → 抛 paused-requeuer: tickState required', async () => {
    await expect(tick({ pool: {} })).rejects.toThrow(/tickState required/);
  });

  it('默认 intervalMs 为 5min（PAUSED_REQUEUE_INTERVAL_MS 语义验证）', async () => {
    // 距上次执行仅 4min59s → 应被节流
    const ts = makeTickState(Date.now() - (5 * 60 * 1000 - 1000));
    const r = await tick({ pool: {}, tickState: ts }); // 不传 intervalMs，使用默认
    expect(r).toEqual({ skipped: true, reason: 'throttled' });
    expect(runPausedRequeue).not.toHaveBeenCalled();
  });
});
