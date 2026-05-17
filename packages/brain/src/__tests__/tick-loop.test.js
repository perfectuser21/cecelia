/**
 * Brain v2 Phase D2.2 — tick-loop 单元测试。
 *
 * 覆盖：
 *   - runTickSafe: 正常 / 节流 / 重入守门 / 注入 tickFn / 错误捕获
 *   - startTickLoop / stopTickLoop: tickState.loopTimer 生命周期
 *   - 常量正确导出
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock executeTick 以避免拉入 tick-runner 整个依赖图
const mockExecuteTick = vi.fn();
vi.mock('../tick-runner.js', () => ({
  executeTick: (...args) => mockExecuteTick(...args),
}));

// Mock taskEvents.publishCognitiveState
vi.mock('../events/taskEvents.js', () => ({
  publishCognitiveState: vi.fn(),
}));

const mockRunScheduler = vi.fn().mockResolvedValue({ dispatched: true, actions: [], elapsed_ms: 10, guidance_found: false });
vi.mock('../tick-scheduler.js', () => ({
  runScheduler: (...args) => mockRunScheduler(...args),
}));
vi.mock('../consciousness-loop.js', () => ({
  startConsciousnessLoop: vi.fn().mockReturnValue(true),
  stopConsciousnessLoop: vi.fn(),
  _runConsciousnessOnce: vi.fn().mockResolvedValue({ completed: true, actions: [] }),
}));

import {
  runTickSafe,
  startTickLoop,
  stopTickLoop,
  TICK_INTERVAL_MINUTES,
  TICK_LOOP_INTERVAL_MS,
  TICK_TIMEOUT_MS,
} from '../tick-loop.js';
import { tickState, resetTickStateForTests } from '../tick-state.js';

describe('tick-loop', () => {
  beforeEach(() => {
    resetTickStateForTests();
    mockExecuteTick.mockReset();
    mockRunScheduler.mockReset();
  });

  afterEach(() => {
    // 清理可能残留的 timer
    if (tickState.loopTimer) {
      clearInterval(tickState.loopTimer);
      tickState.loopTimer = null;
    }
  });

  // ─── 常量 ────────────────────────────────────────────
  describe('常量', () => {
    it('TICK_INTERVAL_MINUTES = 2', () => {
      expect(TICK_INTERVAL_MINUTES).toBe(2);
    });

    it('TICK_LOOP_INTERVAL_MS 为正整数', () => {
      expect(typeof TICK_LOOP_INTERVAL_MS).toBe('number');
      expect(TICK_LOOP_INTERVAL_MS).toBeGreaterThan(0);
    });

    it('TICK_TIMEOUT_MS = 60s', () => {
      expect(TICK_TIMEOUT_MS).toBe(60 * 1000);
    });
  });

  // ─── runTickSafe ─────────────────────────────────────
  describe('runTickSafe', () => {
    it('正常路径：调 doTick 并更新 lastExecuteTime', async () => {
      const tickFn = vi.fn().mockResolvedValue({ actions_taken: ['x'] });
      const before = Date.now();
      const result = await runTickSafe('manual', tickFn);
      expect(tickFn).toHaveBeenCalledTimes(1);
      expect(result.actions_taken).toEqual(['x']);
      expect(tickState.lastExecuteTime).toBeGreaterThanOrEqual(before);
      expect(tickState.tickRunning).toBe(false); // finally 解锁
    });

    it('source=loop + 距上次未到间隔 → 节流', async () => {
      tickState.lastExecuteTime = Date.now() - 30 * 1000; // 30s ago
      const tickFn = vi.fn();
      const result = await runTickSafe('loop', tickFn);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('throttled');
      expect(tickFn).not.toHaveBeenCalled();
    });

    it('source=manual 不受节流限制', async () => {
      tickState.lastExecuteTime = Date.now() - 30 * 1000;
      const tickFn = vi.fn().mockResolvedValue({ actions_taken: [] });
      const result = await runTickSafe('manual', tickFn);
      expect(tickFn).toHaveBeenCalledTimes(1);
      expect(result.skipped).toBeUndefined();
    });

    it('重入守门：tickRunning=true 时跳过', async () => {
      tickState.tickRunning = true;
      tickState.tickLockTime = Date.now();
      const tickFn = vi.fn();
      const result = await runTickSafe('manual', tickFn);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('already_running');
      expect(tickFn).not.toHaveBeenCalled();
    });

    it('重入超时强制释放锁', async () => {
      tickState.tickRunning = true;
      tickState.tickLockTime = Date.now() - (TICK_TIMEOUT_MS + 5000); // 超时
      const tickFn = vi.fn().mockResolvedValue({ actions_taken: [] });
      const result = await runTickSafe('manual', tickFn);
      expect(tickFn).toHaveBeenCalled(); // 强制释放后继续执行
      expect(result.skipped).toBeUndefined();
    });

    it('tickFn 抛错 → 返回 success:false 且 finally 释锁', async () => {
      const tickFn = vi.fn().mockRejectedValue(new Error('boom'));
      const result = await runTickSafe('manual', tickFn);
      expect(result.success).toBe(false);
      expect(result.error).toBe('boom');
      expect(tickState.tickRunning).toBe(false);
      expect(tickState.tickLockTime).toBeNull();
    });

    it('未传 tickFn 时使用默认 runScheduler（Wave 2）', async () => {
      mockRunScheduler.mockResolvedValueOnce({ dispatched: true, actions_taken: [] });
      await runTickSafe('manual');
      expect(mockRunScheduler).toHaveBeenCalledTimes(1);
    });
  });

  // ─── startTickLoop / stopTickLoop ────────────────────
  describe('startTickLoop / stopTickLoop', () => {
    it('startTickLoop 设置 loopTimer 并返回 true', () => {
      expect(tickState.loopTimer).toBeNull();
      const r = startTickLoop();
      expect(r).toBe(true);
      expect(tickState.loopTimer).not.toBeNull();
    });

    it('startTickLoop 重复调用 → 返回 false（已 running）', () => {
      startTickLoop();
      const r = startTickLoop();
      expect(r).toBe(false);
    });

    it('stopTickLoop 清 loopTimer 并返回 true', () => {
      startTickLoop();
      const r = stopTickLoop();
      expect(r).toBe(true);
      expect(tickState.loopTimer).toBeNull();
    });

    it('stopTickLoop 在未 running 时返回 false', () => {
      const r = stopTickLoop();
      expect(r).toBe(false);
    });
  });
});
