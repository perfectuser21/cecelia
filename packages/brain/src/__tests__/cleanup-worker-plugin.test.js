/**
 * cleanup-worker-plugin.test.js — D1.7c plugin 单测
 *
 * 用 loadWorker 注入避免 dynamic import('./cleanup-worker.js') 真跑
 */
import { describe, it, expect, vi } from 'vitest';
import { tick } from '../cleanup-worker-plugin.js';

function makeTickState(last = 0) {
  return { lastCleanupWorkerTime: last };
}

describe('cleanup-worker-plugin', () => {
  it('MINIMAL_MODE → skipped', async () => {
    const r = await tick({
      tickState: makeTickState(0),
      MINIMAL_MODE: true,
      intervalMs: 0,
    });
    expect(r).toEqual({ skipped: true, reason: 'minimal_mode' });
  });

  it('throttled → skipped', async () => {
    const ts = makeTickState(Date.now() - 1000);
    const r = await tick({ tickState: ts, intervalMs: 60_000 });
    expect(r).toEqual({ skipped: true, reason: 'throttled' });
  });

  it('runCleanupWorker 成功 + cleaned>0 → tickLog 被调', async () => {
    const runCleanupWorker = vi.fn().mockResolvedValue({
      success: true,
      stdout: '[cleanup-worker] starting\n[cleanup] removed /a (cp-x)\n[cleanup] removed /b (cp-y)\n',
    });
    const tickLog = vi.fn();
    const ts = makeTickState(0);
    const before = Date.now();
    const r = await tick({
      tickState: ts,
      tickLog,
      intervalMs: 0,
      loadWorker: async () => ({ runCleanupWorker }),
    });
    expect(r.success).toBe(true);
    expect(tickLog).toHaveBeenCalledWith(expect.stringContaining('cleaned=2'));
    expect(ts.lastCleanupWorkerTime).toBeGreaterThanOrEqual(before);
  });

  it('runCleanupWorker 成功 + cleaned=0 → tickLog 不被调', async () => {
    const runCleanupWorker = vi.fn().mockResolvedValue({
      success: true,
      stdout: '[cleanup-worker] starting\n[cleanup-worker] [skip] /x: not merged\n',
    });
    const tickLog = vi.fn();
    await tick({
      tickState: makeTickState(0),
      tickLog,
      intervalMs: 0,
      loadWorker: async () => ({ runCleanupWorker }),
    });
    expect(tickLog).not.toHaveBeenCalled();
  });

  it('runCleanupWorker success=false → console.warn 被调', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runCleanupWorker = vi.fn().mockResolvedValue({
      success: false,
      stdout: '',
      error: 'permission denied',
    });
    await tick({
      tickState: makeTickState(0),
      intervalMs: 0,
      loadWorker: async () => ({ runCleanupWorker }),
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('cleanup-worker failed (non-fatal):'),
      'permission denied'
    );
    warn.mockRestore();
  });

  it('runCleanupWorker 抛错 → 返回 { error }', async () => {
    const runCleanupWorker = vi.fn().mockRejectedValue(new Error('exec timeout'));
    const r = await tick({
      tickState: makeTickState(0),
      intervalMs: 0,
      loadWorker: async () => ({ runCleanupWorker }),
    });
    expect(r.error).toBe('exec timeout');
  });
});
