/**
 * Circuit Breaker HALF_OPEN 探针限制测试
 *
 * 验证 MAX_HALF_OPEN_PROBES 机制：
 *   - HALF_OPEN 状态下探针槽未消耗时 isAllowed() 返回 true
 *   - 调用 recordProbeDispatched() 消耗探针槽后 isAllowed() 返回 false
 *   - 新冷却期（再次进入 HALF_OPEN）探针槽自动重置
 *   - recordProbeDispatched() 在 CLOSED/OPEN 状态下无副作用
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn(async () => {}) }));
vi.mock('../alerting.js', () => ({ raise: vi.fn(async () => {}) }));

import {
  getState,
  isAllowed,
  recordProbeDispatched,
  recordSuccess,
  recordFailure,
  reset,
  FAILURE_THRESHOLD,
  OPEN_DURATION_MS,
  MAX_HALF_OPEN_PROBES
} from '../circuit-breaker.js';

describe('Circuit Breaker HALF_OPEN 探针限制', () => {
  const KEY = 'half-open-limit-test';

  beforeEach(() => {
    vi.clearAllMocks();
    reset(KEY);
    vi.useRealTimers();
  });

  afterEach(() => {
    reset(KEY);
    vi.useRealTimers();
  });

  it('MAX_HALF_OPEN_PROBES 常量值为 1', () => {
    expect(MAX_HALF_OPEN_PROBES).toBe(1);
  });

  describe('HALF_OPEN 探针槽限制', () => {
    it('进入 HALF_OPEN 后未消耗探针槽时 isAllowed() 返回 true', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(KEY);
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS + 1000);

      expect(getState(KEY).state).toBe('HALF_OPEN');
      expect(isAllowed(KEY)).toBe(true);
    });

    it('recordProbeDispatched() 消耗探针槽后 isAllowed() 返回 false', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(KEY);
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS + 1000);

      expect(getState(KEY).state).toBe('HALF_OPEN');
      expect(isAllowed(KEY)).toBe(true);

      // 消耗探针槽
      recordProbeDispatched(KEY);

      // 探针槽已满，不再允许
      expect(isAllowed(KEY)).toBe(false);
    });

    it('getState() 返回正确的 probesSent 值', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(KEY);
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS + 1000);

      expect(getState(KEY).probesSent).toBe(0);

      recordProbeDispatched(KEY);

      expect(getState(KEY).probesSent).toBe(1);
    });

    it('连续调用 recordProbeDispatched() 不超过 MAX_HALF_OPEN_PROBES', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(KEY);
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS + 1000);

      // 消耗一个探针槽
      recordProbeDispatched(KEY);
      expect(isAllowed(KEY)).toBe(false);

      // 多次调用不影响状态
      recordProbeDispatched(KEY);
      recordProbeDispatched(KEY);
      expect(isAllowed(KEY)).toBe(false);
      expect(getState(KEY).state).toBe('HALF_OPEN');
    });
  });

  describe('探针槽重置', () => {
    it('recordSuccess() 后（→ CLOSED）isAllowed() 恢复 true', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(KEY);
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS + 1000);

      recordProbeDispatched(KEY);
      expect(isAllowed(KEY)).toBe(false);

      await recordSuccess(KEY);

      expect(getState(KEY).state).toBe('CLOSED');
      expect(isAllowed(KEY)).toBe(true);
      expect(getState(KEY).probesSent).toBe(0);
    });

    it('recordFailure() 从 HALF_OPEN 失败后（→ OPEN）probesSent 重置', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(KEY);
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS + 1000);

      // 触发 HALF_OPEN 自动转换
      getState(KEY);
      recordProbeDispatched(KEY);
      expect(isAllowed(KEY)).toBe(false);

      // 探针失败 → 回到 OPEN
      await recordFailure(KEY);
      expect(getState(KEY).state).toBe('OPEN');

      // 新冷却期后再次进入 HALF_OPEN，探针槽重置
      vi.advanceTimersByTime(OPEN_DURATION_MS + 1000);
      expect(getState(KEY).state).toBe('HALF_OPEN');
      expect(getState(KEY).probesSent).toBe(0);
      expect(isAllowed(KEY)).toBe(true);
    });

    it('新冷却期（第二次 HALF_OPEN）探针槽自动重置', async () => {
      vi.useFakeTimers();

      // 第一次 OPEN → HALF_OPEN → 消耗探针 → 失败 → OPEN
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(KEY);
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS + 1000);
      getState(KEY); // 触发 OPEN→HALF_OPEN 转换
      recordProbeDispatched(KEY);

      await recordFailure(KEY); // 探针失败 → OPEN
      expect(getState(KEY).state).toBe('OPEN');

      // 第二次冷却 → 新 HALF_OPEN 周期
      vi.advanceTimersByTime(OPEN_DURATION_MS + 1000);

      const s = getState(KEY);
      expect(s.state).toBe('HALF_OPEN');
      expect(s.probesSent).toBe(0);
      expect(isAllowed(KEY)).toBe(true);
    });
  });

  describe('recordProbeDispatched() 在非 HALF_OPEN 状态下无副作用', () => {
    it('CLOSED 状态下 recordProbeDispatched() 不影响 isAllowed()', () => {
      expect(getState(KEY).state).toBe('CLOSED');

      recordProbeDispatched(KEY);

      expect(isAllowed(KEY)).toBe(true);
      expect(getState(KEY).probesSent).toBe(0);
    });

    it('OPEN 状态下 recordProbeDispatched() 不影响状态', async () => {
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(KEY);
      }
      expect(getState(KEY).state).toBe('OPEN');

      recordProbeDispatched(KEY);

      expect(getState(KEY).state).toBe('OPEN');
      expect(isAllowed(KEY)).toBe(false);
    });

    it('未初始化的 key 调用 recordProbeDispatched() 不抛出', () => {
      const unknownKey = 'never-initialized-key';
      expect(() => recordProbeDispatched(unknownKey)).not.toThrow();
      reset(unknownKey);
    });
  });
});
