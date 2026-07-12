/**
 * harness-watchdog-loop.test.js — P1 回归单元测试（2026-06-13）
 *
 * 锁定 runHarnessWatchdogOnce 三条 harness 恢复安全网的不变量：
 *   1. timed-out 恢复：scanStuckHarness — deadline 逾期 initiative_run 标 failed。
 *   2. stuck-in_progress 恢复：resumeStalledHarnessDrivers — 驱动器已死的 parked 任务重排。
 *   3. relay-container-dead 恢复：resumeStalledRelayRuns — relay session 早退后外部重点火。
 *
 * 三条网各自独立 try-catch，互不影响；末尾无条件输出可观测行。
 *
 * 根因（issue 808bec91）：三条网原先只挂在 Wave-2 废弃的 executeTick()，
 * tick-loop 改调 runScheduler 后七天来零执行 → harness-watchdog-loop 独立接回。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockScan = vi.hoisted(() => vi.fn());
const mockResume = vi.hoisted(() => vi.fn());
const mockRelayResume = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../harness-watchdog.js', () => ({
  scanStuckHarness: mockScan,
  resumeStalledHarnessDrivers: mockResume,
}));
// relay-container-dead 恢复：resumeStalledRelayRuns 静态 import 自 harness-relay-watchdog.js。
// mock 以阻断真实 DB 查询 + shell execSync，并让测试精确断言 relay 路径被执行。
vi.mock('../harness-relay-watchdog.js', () => ({
  resumeStalledRelayRuns: mockRelayResume,
}));

let runHarnessWatchdogOnce;

beforeEach(async () => {
  vi.resetModules();
  mockScan.mockReset();
  mockResume.mockReset();
  mockRelayResume.mockReset();
  const mod = await import('../harness-watchdog-loop.js');
  runHarnessWatchdogOnce = mod.runHarnessWatchdogOnce;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runHarnessWatchdogOnce — 可观测性 + 独立 try-catch', () => {
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
    mockRelayResume.mockResolvedValue({ resumed: 0, scanned: 0 });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(runHarnessWatchdogOnce()).resolves.toMatchObject({ resumed: 0 });
    const logged = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toMatch(/\[harness-watchdog\] scanned=\d+/);
  });

  // ── relay-container-dead 恢复（安全网 3，issue 808bec91）──────────────────────
  it('relay-container-dead 恢复：resumeStalledRelayRuns 被调用，relay 计数写入可观测行', async () => {
    mockScan.mockResolvedValue({ scanned: 1, flagged: [] });
    mockResume.mockResolvedValue({ scanned: 1, resumed: [] });
    mockRelayResume.mockResolvedValue({ resumed: 2, scanned: 3 });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const r = await runHarnessWatchdogOnce();

    expect(mockRelayResume).toHaveBeenCalledTimes(1);
    expect(r.relay).toBe(2);
    const logged = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toMatch(/\[harness-watchdog\].*relay=2/);
  });

  it('relay 抛错时 scan 和 resume 仍执行（三条网各自独立 try-catch）', async () => {
    mockScan.mockResolvedValue({ scanned: 2, flagged: ['r1'] });
    mockResume.mockResolvedValue({ scanned: 1, resumed: ['t1'] });
    mockRelayResume.mockRejectedValue(new Error('relay boom'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await runHarnessWatchdogOnce();

    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(r.flagged).toBe(1);
    expect(r.resumed).toBe(1);
    expect(r.relay).toBe(0);
  });
});
