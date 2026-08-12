/**
 * harness-watchdog-loop.test.js — P1 回归（loop 级，2026-06-13）
 *
 * 锁定独立看门狗循环（startHarnessWatchdogLoop）的核心不变量：
 *   - 独立 setInterval **周期** 触发 scan + resume，完全不依赖任何 tick body
 *     （runScheduler / executeTick）跑完 —— 这是本次 P1 修复的根本：watchdog 原先只接在
 *     Wave-2 废弃的 executeTick，从不被调用。
 *   - 重复 start 返回 false（防止双循环）。
 *
 * 函数级不变量（无条件 log / 独立 try-catch）见
 * packages/brain/src/__tests__/harness-watchdog-loop.test.js。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockScan = vi.hoisted(() => vi.fn());
const mockResume = vi.hoisted(() => vi.fn());

vi.mock('../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../../packages/brain/src/harness-watchdog.js', () => ({
  scanStuckHarness: mockScan,
  resumeStalledHarnessDrivers: mockResume,
}));

let startHarnessWatchdogLoop, stopHarnessWatchdogLoop;

beforeEach(async () => {
  vi.resetModules();
  mockScan.mockReset();
  mockResume.mockReset();
  const mod = await import('../../packages/brain/src/harness-watchdog-loop.js');
  startHarnessWatchdogLoop = mod.startHarnessWatchdogLoop;
  stopHarnessWatchdogLoop = mod.stopHarnessWatchdogLoop;
});

afterEach(() => {
  stopHarnessWatchdogLoop?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startHarnessWatchdogLoop — 独立 setInterval，不依赖 tick body', () => {
  it('独立 setInterval 周期触发 scan + resume（与任何调度层解耦）', async () => {
    vi.useFakeTimers();
    mockScan.mockResolvedValue({ scanned: 0, flagged: [] });
    mockResume.mockResolvedValue({ scanned: 0, resumed: [] });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    startHarnessWatchdogLoop({ intervalMs: 1000 });

    // 启动 eager scan + 第一次周期触发
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(mockResume).toHaveBeenCalledTimes(2);

    // 第二次周期触发 —— 证明是真正的周期循环，不是一次性
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockScan).toHaveBeenCalledTimes(3);
    expect(mockResume).toHaveBeenCalledTimes(3);
  });

  it('重复 start 返回 false（防止双循环）', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(startHarnessWatchdogLoop({ intervalMs: 1000 })).toBe(true);
    expect(startHarnessWatchdogLoop({ intervalMs: 1000 })).toBe(false);
  });
});
