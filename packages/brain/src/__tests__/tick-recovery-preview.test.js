/**
 * [BEHAVIOR] B-1~B-4: tick-recovery.js BRAIN_PREVIEW=1 守卫测试
 *
 * 根因：initTickLoop / tryRecoverTickLoop 缺少 BRAIN_PREVIEW 守卫，
 * Preview Brain 启动时克隆 DB tick_enabled=true，导致主 Tick 并发双派发。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- mock 所有有副作用的依赖 ----

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../tick-state.js', () => ({
  tickState: {
    loopTimer: null,
    recoveryTimer: null,
  },
}));

vi.mock('../alertness/index.js', () => ({
  initAlertness: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../tick-watchdog.js', () => ({
  startTickWatchdog: vi.fn(),
}));

vi.mock('../tick.js', () => ({
  getTickStatus: vi.fn().mockResolvedValue({ enabled: true }),
}));

vi.mock('../tick-loop.js', () => ({
  startTickLoop: vi.fn(),
  stopTickLoop: vi.fn(),
}));

vi.mock('../event-bus.js', () => ({
  ensureEventsTable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../drain.js', () => ({
  restoreDrainState: vi.fn().mockResolvedValue(undefined),
}));

import { initTickLoop, tryRecoverTickLoop } from '../tick-recovery.js';
import { startTickLoop } from '../tick-loop.js';
import { tickState } from '../tick-state.js';

describe('tick-recovery Preview Brain 隔离（BRAIN_PREVIEW=1）', () => {
  let consoleSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    delete process.env.BRAIN_PREVIEW;
    // 默认 recoveryTimer 为 null（loopTimer=null 表示 loop 未运行）
    tickState.loopTimer = null;
    tickState.recoveryTimer = null;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    delete process.env.BRAIN_PREVIEW;
  });

  // [BEHAVIOR] B-1: initTickLoop() 在 BRAIN_PREVIEW=1 时返回 preview 结果，startTickLoop 不被调用
  it('[B-1] initTickLoop() BRAIN_PREVIEW=1 时返回 {success:true,enabled:false,loop_running:false,preview:true}，startTickLoop 不被调用', async () => {
    process.env.BRAIN_PREVIEW = '1';

    const result = await initTickLoop();

    expect(result).toEqual({
      success: true,
      enabled: false,
      loop_running: false,
      preview: true,
    });
    expect(startTickLoop).not.toHaveBeenCalled();
  });

  // [BEHAVIOR] B-2: tryRecoverTickLoop() 在 BRAIN_PREVIEW=1 时清除 recoveryTimer 后 return，startTickLoop 不被调用
  it('[B-2] tryRecoverTickLoop() BRAIN_PREVIEW=1 时清除 recoveryTimer 并 return，startTickLoop 不被调用', async () => {
    process.env.BRAIN_PREVIEW = '1';

    // 模拟 recoveryTimer 已存在（有一个假定时器）
    const fakeTimer = setInterval(() => {}, 99999);
    tickState.recoveryTimer = fakeTimer;

    await tryRecoverTickLoop();

    // recoveryTimer 应被清除
    expect(tickState.recoveryTimer).toBeNull();
    // startTickLoop 绝不应被调用
    expect(startTickLoop).not.toHaveBeenCalled();

    // 清理假 timer（防止测试泄漏）
    clearInterval(fakeTimer);
  });

  // [BEHAVIOR] B-3: initTickLoop() 在 BRAIN_PREVIEW=1 时打印含 "BRAIN_PREVIEW" 的日志
  it('[B-3] initTickLoop() BRAIN_PREVIEW=1 时调用 console.log 且输出包含 "BRAIN_PREVIEW"', async () => {
    process.env.BRAIN_PREVIEW = '1';

    await initTickLoop();

    const logged = consoleSpy.mock.calls.flat().join(' ');
    expect(logged).toMatch(/BRAIN_PREVIEW/);
  });

  // [BEHAVIOR] B-4: BRAIN_PREVIEW 未设置时，initTickLoop() 在 DB tick_enabled=true 时调用 startTickLoop()（零回归）
  it('[B-4] BRAIN_PREVIEW 未设置时，initTickLoop() 在 DB tick_enabled=true 时正常调用 startTickLoop()', async () => {
    // BRAIN_PREVIEW 不设置
    // getTickStatus mock 已返回 { enabled: true }

    await initTickLoop();

    expect(startTickLoop).toHaveBeenCalledTimes(1);
  });
});
