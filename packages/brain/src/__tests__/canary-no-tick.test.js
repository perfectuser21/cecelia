/**
 * canary-no-tick.test.js
 * BRAIN_DEPLOY_CANARY=1 时 initTickLoop 必须早返，不启动 tick loop——
 * 否则 green canary 会和 blue 连同一 DB double-dispatch（issue f38f989f 修复的一部分）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 轻量 mock：早返路径下这些都不该被调，但模块 import 需成功
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../tick-state.js', () => ({ tickState: {} }));
vi.mock('../alertness/index.js', () => ({ initAlertness: vi.fn() }));
vi.mock('../tick-watchdog.js', () => ({ startTickWatchdog: vi.fn() }));
vi.mock('../tick.js', () => ({ getTickStatus: vi.fn() }));
vi.mock('../tick-loop.js', () => ({ startTickLoop: vi.fn(), stopTickLoop: vi.fn() }));
vi.mock('../event-bus.js', () => ({ ensureEventsTable: vi.fn() }));

describe('canary tick gate', () => {
  beforeEach(() => vi.resetModules());

  it('BRAIN_DEPLOY_CANARY=1 → initTickLoop 早返，不调 startTickLoop（压过 auto-enable）', async () => {
    vi.stubEnv('BRAIN_DEPLOY_CANARY', '1');
    // 即使 auto-enable 打开，canary 门也必须优先——否则 green 会 double-dispatch
    vi.stubEnv('CECELIA_TICK_ENABLED', 'true');
    const loop = await import('../tick-loop.js');
    const { initTickLoop } = await import('../tick-recovery.js');
    const r = await initTickLoop();
    // canary 模式：tick loop 绝不启动
    expect(loop.startTickLoop).not.toHaveBeenCalled();
    // 早返返回体明确标记 canary + 未启用 + loop 未跑
    expect(r.canary).toBe(true);
    expect(r.enabled).toBe(false);
    expect(r.loop_running).toBe(false);
    expect(r.success).toBe(true);
    vi.unstubAllEnvs();
  });
});
