/** 真实后台启动集合：保留调度、恢复与能力探针，不注册无业务消费者的定时器。 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() } }));
vi.mock('../capability-probe.js', () => ({ startProbeLoop: vi.fn() }));
vi.mock('../consciousness-loop.js', () => ({ startConsciousnessLoop: vi.fn() }));
vi.mock('../recovery-loop.js', () => ({ startRecoveryLoop: vi.fn(), stopRecoveryLoop: vi.fn() }));
vi.mock('../events/taskEvents.js', () => ({ publishCognitiveState: vi.fn() }));
vi.mock('../tick-stats.js', () => ({ recordTickExecution: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../tick-scheduler.js', () => ({ runScheduler: vi.fn().mockResolvedValue({ actions_taken: [] }) }));

import { startTickLoop, stopTickLoop, TICK_LOOP_INTERVAL_MS } from '../tick-loop.js';
import { startProbeLoop } from '../capability-probe.js';
import { startConsciousnessLoop } from '../consciousness-loop.js';
import { startRecoveryLoop, stopRecoveryLoop } from '../recovery-loop.js';
import { runScheduler } from '../tick-scheduler.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  stopTickLoop();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('startTickLoop', () => {
  it('启动集合保留现役组件，实际只注册调度定时器并执行调度', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    expect(startTickLoop()).toBe(true);
    expect(startProbeLoop).toHaveBeenCalledOnce();
    expect(startRecoveryLoop).toHaveBeenCalledOnce();
    expect(startConsciousnessLoop).toHaveBeenCalledOnce();
    // 兄弟组件在此为边界 mock；任何额外真实后台循环都会增加注册项。
    expect(intervals.mock.calls.map(([, delay]) => delay)).toEqual([TICK_LOOP_INTERVAL_MS]);
    await vi.advanceTimersByTimeAsync(TICK_LOOP_INTERVAL_MS);
    expect(runScheduler).toHaveBeenCalledOnce();
    expect(stopTickLoop()).toBe(true);
    expect(stopRecoveryLoop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('重复启动保持幂等，停止后能重新启动现役组件', () => {
    expect(startTickLoop()).toBe(true);
    expect(startTickLoop()).toBe(false);
    expect(startProbeLoop).toHaveBeenCalledOnce();
    expect(startRecoveryLoop).toHaveBeenCalledOnce();
    expect(stopTickLoop()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(startTickLoop()).toBe(true);
    expect(startProbeLoop).toHaveBeenCalledTimes(2);
    expect(startRecoveryLoop).toHaveBeenCalledTimes(2);
  });
});
