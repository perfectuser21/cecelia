/**
 * harness-watchdog-loop.test.js — P1 回归单元测试（2026-06-13）
 *
 * 锁定 runHarnessWatchdogOnce 的不变量（loop 级周期触发见
 * tests/integration/harness-watchdog-loop.test.js）：
 *   1. 每次执行无条件输出可观测行 `[harness-watchdog] scanned=N ...`（即使 resumed=0）。
 *   2. scan 与 resume 各自独立 try-catch —— 一个抛错不跳过另一个、仍输出可观测行。
 *   3. 任一子步骤抛错都不向上抛出（绝不杀掉调用方/interval）。
 *
 * 根因：harness watchdog 原先只接在 Wave-2 废弃的 executeTick()，tick-loop 改调
 * runScheduler 后从不被调用 → 函数正确但生产中从未执行。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockScan = vi.hoisted(() => vi.fn());
const mockResume = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../harness-watchdog.js', () => ({
  scanStuckHarness: mockScan,
  resumeStalledHarnessDrivers: mockResume,
}));

let runHarnessWatchdogOnce;
let startHarnessWatchdogLoop;
let stopHarnessWatchdogLoop;

beforeEach(async () => {
  vi.resetModules();
  mockScan.mockReset();
  mockResume.mockReset();
  const mod = await import('../harness-watchdog-loop.js');
  runHarnessWatchdogOnce = mod.runHarnessWatchdogOnce;
  startHarnessWatchdogLoop = mod.startHarnessWatchdogLoop;
  stopHarnessWatchdogLoop = mod.stopHarnessWatchdogLoop;
});

afterEach(() => {
  stopHarnessWatchdogLoop?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runHarnessWatchdogOnce — 可观测性 + 独立 try-catch', () => {
  it('启动时立即执行一次受同一重入守卫保护的恢复扫描', async () => {
    vi.useFakeTimers();
    const runOnce = vi.fn().mockResolvedValue({ scanned: 1, resumed: 1 });

    expect(startHarnessWatchdogLoop({ intervalMs: 300_000, runOnce })).toBe(true);
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(300_000);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });
  it('首轮仍执行时 stop→start 不会并发两轮，也不会让旧轮清掉新实例守卫', async () => {
    vi.useFakeTimers();
    let releaseFirst;
    let active = 0;
    let maxActive = 0;
    const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
    const runOnce = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (runOnce.mock.calls.length === 1) await firstPending;
      active--;
      return { scanned: 1 };
    });

    startHarnessWatchdogLoop({ intervalMs: 300_000, runOnce });
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));
    stopHarnessWatchdogLoop();
    startHarnessWatchdogLoop({ intervalMs: 300_000, runOnce });
    await Promise.resolve();
    expect(runOnce).toHaveBeenCalledTimes(1);

    releaseFirst();
    await vi.waitFor(() => expect(active).toBe(0));
    await vi.advanceTimersByTimeAsync(300_000);

    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });
  it('resumed=0 时仍无条件输出 [harness-watchdog] scanned=N flagged=F resumed=M', async () => {
    mockScan.mockResolvedValue({ scanned: 0, flagged: [] });
    mockResume.mockResolvedValue({ scanned: 1, resumed: [] });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const r = await runHarnessWatchdogOnce();

    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(r.resumed).toBe(0);
    const logged = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toMatch(/\[harness-watchdog\] scanned=\d+ flagged=\d+ resumed=\d+/);
  });

  it('scan 抛错时 resume 仍执行且仍输出可观测行（独立 try-catch）', async () => {
    mockScan.mockRejectedValue(new Error('scan boom'));
    mockResume.mockResolvedValue({ scanned: 2, resumed: ['task-1'] });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await runHarnessWatchdogOnce();

    // resume 没被 scan 异常跳过
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(r.resumed).toBe(1);
    const logged = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toMatch(/\[harness-watchdog\] scanned=\d+ flagged=\d+ resumed=1/);
  });

  it('resume 抛错不向上抛出、仍输出可观测行（绝不杀掉调用方）', async () => {
    mockScan.mockResolvedValue({ scanned: 0, flagged: [] });
    mockResume.mockRejectedValue(new Error('resume boom'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(runHarnessWatchdogOnce()).resolves.toMatchObject({ resumed: 0 });
    const logged = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toMatch(/\[harness-watchdog\] scanned=\d+/);
  });
});
