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

// Mock db.js pool（tick_last 更新，避免拉实际数据库）
const mockPoolQuery = vi.fn().mockResolvedValue({ rows: [] });
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockPoolQuery(...args) },
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
// P1 修复：独立 harness 看门狗循环由 startTickLoop 启动。mock 以验证「被接上」+ 避免拉 db。
const mockStartHarnessWatchdogLoop = vi.fn().mockReturnValue(true);
const mockStopHarnessWatchdogLoop = vi.fn();
vi.mock('../harness-watchdog-loop.js', () => ({
  startHarnessWatchdogLoop: (...args) => mockStartHarnessWatchdogLoop(...args),
  stopHarnessWatchdogLoop: (...args) => mockStopHarnessWatchdogLoop(...args),
}));
// Slice5：独立 pipeline 巡航循环由 startTickLoop 启动。mock 以验证「被接上」+ 避免拉 db。
const mockStartPipelinePatrolLoop = vi.fn().mockReturnValue(true);
const mockStopPipelinePatrolLoop = vi.fn();
vi.mock('../pipeline-patrol-loop.js', () => ({
  startPipelinePatrolLoop: (...args) => mockStartPipelinePatrolLoop(...args),
  stopPipelinePatrolLoop: (...args) => mockStopPipelinePatrolLoop(...args),
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
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] });
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

    // 回归测试（PROBE_FAIL_RUMINATION fix）：
    // Wave 2 迁移后 runScheduler 取代 executeTick，但 executeTick 才更新 tick_last。
    // 结果：tick_last 停留在 May 5（迁移前最后一次 executeTick），probe 误判为 loop_dead。
    // 修复：runTickSafe 成功后 fire-and-forget 更新 tick_last。
    it('tick 成功执行后更新 working_memory tick_last（修复 probe 误判 loop_dead）', async () => {
      const tickFn = vi.fn().mockResolvedValue({ actions_taken: [] });
      await runTickSafe('manual', tickFn);
      // pool.query 被调用，且包含 tick_last 的 INSERT/UPDATE
      const tickLastCall = mockPoolQuery.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('tick_last')
      );
      expect(tickLastCall).toBeDefined();
      // 第二个参数是 [JSON.stringify({ timestamp: ... })]
      const payload = JSON.parse(tickLastCall[1][0]);
      expect(payload).toHaveProperty('timestamp');
      expect(typeof payload.timestamp).toBe('string');
    });

    it('tick 失败时不更新 tick_last（仅成功时更新）', async () => {
      const tickFn = vi.fn().mockRejectedValue(new Error('tick boom'));
      await runTickSafe('manual', tickFn);
      const tickLastCall = mockPoolQuery.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('tick_last')
      );
      expect(tickLastCall).toBeUndefined();
    });

    it('节流时不更新 tick_last（tick 未执行）', async () => {
      tickState.lastExecuteTime = Date.now() - 30 * 1000; // 30s ago，未到 2min
      await runTickSafe('loop');
      const tickLastCall = mockPoolQuery.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('tick_last')
      );
      expect(tickLastCall).toBeUndefined();
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

    // P1 回归（2026-06-13）：harness watchdog 必须由 startTickLoop 接上独立循环。
    // 历史 bug：watchdog 只接在 Wave-2 废弃的 executeTick，runScheduler 路径从不调用 → 形同虚设。
    it('startTickLoop 启动独立 harness 看门狗循环（startHarnessWatchdogLoop 被调用）', () => {
      mockStartHarnessWatchdogLoop.mockClear();
      startTickLoop();
      expect(mockStartHarnessWatchdogLoop).toHaveBeenCalledTimes(1);
    });

    it('stopTickLoop 同步停掉 harness 看门狗循环（start/stop 对称）', () => {
      mockStopHarnessWatchdogLoop.mockClear();
      startTickLoop();
      stopTickLoop();
      expect(mockStopHarnessWatchdogLoop).toHaveBeenCalledTimes(1);
    });

    // Slice5 回归：pipeline-patrol 巡航必须由 startTickLoop 接上独立循环。
    // 历史 bug：只挂在 Wave-2 废弃的 executeTick，runScheduler 路径从不调用 → harness_intervention 死代码。
    it('startTickLoop 启动独立 pipeline 巡航循环（startPipelinePatrolLoop 被调用）', () => {
      mockStartPipelinePatrolLoop.mockClear();
      startTickLoop();
      expect(mockStartPipelinePatrolLoop).toHaveBeenCalledTimes(1);
    });

    it('stopTickLoop 同步停掉 pipeline 巡航循环（start/stop 对称）', () => {
      mockStopPipelinePatrolLoop.mockClear();
      startTickLoop();
      stopTickLoop();
      expect(mockStopPipelinePatrolLoop).toHaveBeenCalledTimes(1);
    });
  });
});
