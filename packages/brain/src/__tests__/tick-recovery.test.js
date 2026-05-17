/**
 * Brain v2 Phase D2.3 — tick-recovery 单元测试。
 *
 * 覆盖：
 *   - enableTick: 写 DB + startTickLoop
 *   - disableTick: 写 DB（含 source）+ stopTickLoop
 *   - _recordRecoveryAttempt: 写 working_memory.recovery_attempts
 *   - tryRecoverTickLoop: 已运行 loop → 清 recoveryTimer / disabled in DB → skip
 *   - initTickLoop: enabled 时启动 / 失败时启动后台 recovery timer
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 所有外部依赖
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

vi.mock('../alertness/index.js', () => ({
  initAlertness: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../tick-watchdog.js', () => ({
  startTickWatchdog: vi.fn(),
}));

const mockGetTickStatus = vi.fn();
vi.mock('../tick.js', () => ({
  getTickStatus: (...args) => mockGetTickStatus(...args),
}));

const mockStartTickLoop = vi.fn();
const mockStopTickLoop = vi.fn();
vi.mock('../tick-loop.js', () => ({
  startTickLoop: (...args) => mockStartTickLoop(...args),
  stopTickLoop: (...args) => mockStopTickLoop(...args),
}));

vi.mock('../event-bus.js', () => ({
  ensureEventsTable: vi.fn().mockResolvedValue(undefined),
}));

import {
  _recordRecoveryAttempt,
  tryRecoverTickLoop,
  initTickLoop,
  enableTick,
  disableTick,
} from '../tick-recovery.js';
import { tickState, resetTickStateForTests } from '../tick-state.js';

describe('tick-recovery', () => {
  beforeEach(() => {
    resetTickStateForTests();
    vi.clearAllMocks();
    delete process.env.CECELIA_TICK_ENABLED;
  });

  afterEach(() => {
    if (tickState.recoveryTimer) {
      clearInterval(tickState.recoveryTimer);
      tickState.recoveryTimer = null;
    }
  });

  // ─── enableTick ─────────────────────────────────────────
  describe('enableTick', () => {
    it('写 working_memory tick_enabled=true + 启动 loop', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const r = await enableTick();
      expect(r).toEqual({ success: true, enabled: true, loop_running: true });
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO working_memory/);
      expect(mockQuery.mock.calls[0][1][1]).toEqual({ enabled: true });
      expect(mockStartTickLoop).toHaveBeenCalledTimes(1);
    });
  });

  // ─── disableTick ────────────────────────────────────────
  describe('disableTick', () => {
    it('写 enabled=false + source + 停 loop', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const r = await disableTick('manual');
      expect(r.success).toBe(true);
      expect(r.enabled).toBe(false);
      expect(r.source).toBe('manual');
      expect(mockStopTickLoop).toHaveBeenCalledTimes(1);
      const persisted = mockQuery.mock.calls[0][1][1];
      expect(persisted.enabled).toBe(false);
      expect(persisted.source).toBe('manual');
      expect(persisted.disabled_at).toBeTruthy();
    });

    it('source 默认 = "manual"', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const r = await disableTick();
      expect(r.source).toBe('manual');
    });
  });

  // ─── _recordRecoveryAttempt ─────────────────────────────
  describe('_recordRecoveryAttempt', () => {
    it('成功路径：append attempts，写入 last_success_at', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPSERT

      await _recordRecoveryAttempt(true);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const upsert = mockQuery.mock.calls[1][1][1];
      expect(upsert.attempts).toHaveLength(1);
      expect(upsert.attempts[0].success).toBe(true);
      expect(upsert.last_success_at).toBeTruthy();
      expect(upsert.total_attempts).toBe(1);
    });

    it('失败路径：记录 errMessage', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: { attempts: [], total_attempts: 0, last_success_at: null } }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await _recordRecoveryAttempt(false, 'boom');

      const upsert = mockQuery.mock.calls[1][1][1];
      expect(upsert.attempts[0].success).toBe(false);
      expect(upsert.attempts[0].error).toBe('boom');
      expect(upsert.last_success_at).toBeNull();
    });

    it('attempts 只保留最近 50 条', async () => {
      const existing = Array.from({ length: 60 }, (_, i) => ({ ts: `t${i}`, success: true }));
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: { attempts: existing, total_attempts: 60, last_success_at: 't59' } }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await _recordRecoveryAttempt(true);

      const upsert = mockQuery.mock.calls[1][1][1];
      expect(upsert.attempts).toHaveLength(50);
      // 末尾是新的 attempt
      expect(upsert.attempts.at(-1).ts).not.toBe('t59');
    });

    it('SELECT 失败时静默吞掉异常', async () => {
      mockQuery.mockRejectedValueOnce(new Error('db down'));

      // 不应抛
      await expect(_recordRecoveryAttempt(true)).resolves.toBeUndefined();
    });
  });

  // ─── tryRecoverTickLoop ─────────────────────────────────
  describe('tryRecoverTickLoop', () => {
    it('loopTimer 已存在 → 清 recoveryTimer + 直接 return', async () => {
      tickState.loopTimer = setInterval(() => {}, 1000);
      tickState.loopTimer.unref?.();
      tickState.recoveryTimer = setInterval(() => {}, 1000);
      tickState.recoveryTimer.unref?.();
      const recoveryRef = tickState.recoveryTimer;

      await tryRecoverTickLoop();
      expect(tickState.recoveryTimer).toBeNull();
      // 没启动新 loop
      expect(mockStartTickLoop).not.toHaveBeenCalled();
      // 不调 getTickStatus（短路返回）
      expect(mockGetTickStatus).not.toHaveBeenCalled();

      clearInterval(tickState.loopTimer);
      tickState.loopTimer = null;
      clearInterval(recoveryRef);
    });

    it('tick disabled in DB → 不启动 loop，记录失败原因', async () => {
      mockGetTickStatus.mockResolvedValueOnce({ enabled: false });
      mockQuery.mockResolvedValue({ rows: [] }); // _recordRecoveryAttempt 写入

      await tryRecoverTickLoop();

      expect(mockStartTickLoop).not.toHaveBeenCalled();
      // _recordRecoveryAttempt 调过（写 attempts）
      expect(mockQuery).toHaveBeenCalled();
    });

    it('成功路径：DB enabled → startTickLoop 并清 recoveryTimer', async () => {
      mockGetTickStatus.mockResolvedValueOnce({ enabled: true });
      mockQuery.mockResolvedValue({ rows: [] });

      tickState.recoveryTimer = setInterval(() => {}, 1000);
      tickState.recoveryTimer.unref?.();

      await tryRecoverTickLoop();
      expect(mockStartTickLoop).toHaveBeenCalledTimes(1);
      expect(tickState.recoveryTimer).toBeNull();
    });
  });

  // ─── initTickLoop ───────────────────────────────────────
  describe('initTickLoop', () => {
    it('enabled in DB → startTickLoop', async () => {
      mockGetTickStatus.mockResolvedValueOnce({ enabled: true });

      await initTickLoop();
      expect(mockStartTickLoop).toHaveBeenCalledTimes(1);
    });

    it('CECELIA_TICK_ENABLED=true → 直接 enableTick', async () => {
      process.env.CECELIA_TICK_ENABLED = 'true';
      mockQuery.mockResolvedValue({ rows: [] });

      await initTickLoop();
      // enableTick 内部调 startTickLoop
      expect(mockStartTickLoop).toHaveBeenCalledTimes(1);
    });

    it('init 抛错 → 启动后台 recovery timer', async () => {
      // 让 ensureEventsTable 抛
      const eventBus = await import('../event-bus.js');
      eventBus.ensureEventsTable.mockRejectedValueOnce(new Error('table missing'));

      await initTickLoop();
      expect(tickState.recoveryTimer).not.toBeNull();
    });
  });
});
