/**
 * circuit-breaker.js 单元测试
 *
 * 测试场景：
 *   - 熔断器关闭状态（正常通过）
 *   - 错误累积触发熔断（OPEN 状态）
 *   - 半开状态（HALF_OPEN）尝试恢复
 *   - 熔断器重置
 *   - 超时后自动恢复
 *   - getAllStates 多 key 管理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 外部依赖
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn(async () => {}) }));
vi.mock('../alerting.js', () => ({ raise: vi.fn(async () => {}) }));

import {
  getState,
  isAllowed,
  recordSuccess,
  recordFailure,
  reset,
  getAllStates,
  FAILURE_THRESHOLD,
  OPEN_DURATION_MS,
} from '../circuit-breaker.js';

import { emit } from '../event-bus.js';
import { raise } from '../alerting.js';

describe('circuit-breaker', () => {
  beforeEach(() => {
    // 每个测试前重置所有熔断器 + mock
    reset('default');
    reset('worker-a');
    reset('worker-b');
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ========== 常量验证 ==========
  describe('常量', () => {
    it('FAILURE_THRESHOLD 应为 8', () => {
      expect(FAILURE_THRESHOLD).toBe(8);
    });

    it('OPEN_DURATION_MS 应为 5 分钟', () => {
      expect(OPEN_DURATION_MS).toBe(5 * 60 * 1000);
    });
  });

  // ========== 关闭状态（CLOSED）==========
  describe('关闭状态（CLOSED）- 正常通过', () => {
    it('新 key 默认为 CLOSED 状态', () => {
      const s = getState('fresh-key');
      expect(s.state).toBe('CLOSED');
      expect(s.failures).toBe(0);
      expect(s.lastFailureAt).toBeNull();
      expect(s.openedAt).toBeNull();
      // 清理
      reset('fresh-key');
    });

    it('不传 key 时使用 default', () => {
      const s = getState();
      expect(s.state).toBe('CLOSED');
    });

    it('CLOSED 状态允许派发', () => {
      expect(isAllowed('default')).toBe(true);
    });

    it('失败次数未达阈值时保持 CLOSED', async () => {
      await recordFailure('worker-a');
      await recordFailure('worker-a');
      const s = getState('worker-a');
      expect(s.state).toBe('CLOSED');
      expect(s.failures).toBe(2);
      expect(isAllowed('worker-a')).toBe(true);
    });

    it('getState 返回副本，不影响内部状态', () => {
      const s = getState('default');
      s.state = 'OPEN';
      s.failures = 999;
      const s2 = getState('default');
      expect(s2.state).toBe('CLOSED');
      expect(s2.failures).toBe(0);
    });
  });

  // ========== 错误累积触发熔断（OPEN 状态）==========
  describe('错误累积触发熔断（OPEN 状态）', () => {
    it('连续失败达到阈值后触发 OPEN', async () => {
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      const s = getState('worker-a');
      expect(s.state).toBe('OPEN');
      expect(s.failures).toBe(FAILURE_THRESHOLD);
      expect(s.openedAt).not.toBeNull();
    });

    it('OPEN 状态阻止派发', async () => {
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      expect(isAllowed('worker-a')).toBe(false);
    });

    it('触发 OPEN 时发送 circuit_open 事件', async () => {
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      expect(emit).toHaveBeenCalledWith('circuit_open', 'circuit_breaker', {
        key: 'worker-a',
        reason: 'failure_threshold_reached',
        failures: FAILURE_THRESHOLD,
      });
    });

    it('触发 OPEN 时调用 raise 报警', async () => {
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      expect(raise).toHaveBeenCalledWith(
        'P0',
        'circuit_open_worker-a',
        expect.stringContaining('熔断触发')
      );
    });

    it('超过阈值继续失败不会重复触发 OPEN 事件', async () => {
      // 先触发 OPEN
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      vi.clearAllMocks();

      // 再多失败一次（已经是 OPEN 状态，不是 CLOSED 也不是 HALF_OPEN）
      await recordFailure('worker-a');
      // 不应该再次触发 circuit_open 事件
      expect(emit).not.toHaveBeenCalled();
    });

    it('不同 key 的熔断器互不影响', async () => {
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      expect(isAllowed('worker-a')).toBe(false);
      expect(isAllowed('worker-b')).toBe(true);
    });

    it('lastFailureAt 记录最后失败时间', async () => {
      vi.useFakeTimers();
      const t1 = Date.now();
      await recordFailure('worker-a');
      const s1 = getState('worker-a');
      expect(s1.lastFailureAt).toBe(t1);

      vi.advanceTimersByTime(5000);
      await recordFailure('worker-a');
      const s2 = getState('worker-a');
      expect(s2.lastFailureAt).toBe(t1 + 5000);
    });
  });

  // ========== 半开状态（HALF_OPEN）尝试恢复 ==========
  describe('半开状态（HALF_OPEN）尝试恢复', () => {
    it('OPEN 超时后自动转为 HALF_OPEN', async () => {
      vi.useFakeTimers();

      // 触发 OPEN
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      expect(getState('worker-a').state).toBe('OPEN');

      // 推进 30 分钟
      vi.advanceTimersByTime(OPEN_DURATION_MS);

      const s = getState('worker-a');
      expect(s.state).toBe('HALF_OPEN');
    });

    it('HALF_OPEN 状态允许派发（探针）', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS);

      expect(isAllowed('worker-a')).toBe(true);
    });

    it('HALF_OPEN 成功后恢复为 CLOSED', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS);

      // 确认进入 HALF_OPEN
      expect(getState('worker-a').state).toBe('HALF_OPEN');

      // 记录成功
      await recordSuccess('worker-a');

      const s = getState('worker-a');
      expect(s.state).toBe('CLOSED');
      expect(s.failures).toBe(0);
      expect(s.openedAt).toBeNull();
    });

    it('HALF_OPEN 成功后发送 circuit_closed 事件', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS);
      // 重置调用记录但保留 mock 实现
      emit.mockClear();
      raise.mockClear();

      await recordSuccess('worker-a');

      expect(emit).toHaveBeenCalledWith('circuit_closed', 'circuit_breaker', {
        key: 'worker-a',
        previous_state: 'HALF_OPEN',
        previous_failures: FAILURE_THRESHOLD,
      });
    });

    it('HALF_OPEN 失败后回到 OPEN', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS);

      // 确认 HALF_OPEN
      expect(getState('worker-a').state).toBe('HALF_OPEN');
      // 重置调用记录但保留 mock 实现
      emit.mockClear();
      raise.mockClear();

      // 探针失败
      await recordFailure('worker-a');

      const s = getState('worker-a');
      expect(s.state).toBe('OPEN');
      expect(s.openedAt).not.toBeNull();
    });

    it('HALF_OPEN 探针失败发送 circuit_open 事件（half_open_probe_failed）', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS);
      // 重置调用记录但保留 mock 实现（返回 Promise）
      emit.mockClear();
      raise.mockClear();

      // 必须先调用 getState 触发 OPEN -> HALF_OPEN 自动转换
      getState('worker-a');
      await recordFailure('worker-a');

      expect(emit).toHaveBeenCalledWith('circuit_open', 'circuit_breaker', {
        key: 'worker-a',
        reason: 'half_open_probe_failed',
        failures: FAILURE_THRESHOLD + 1,
      });
    });

    it('HALF_OPEN 探针失败调用 raise 报警', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      vi.advanceTimersByTime(OPEN_DURATION_MS);
      // 重置调用记录但保留 mock 实现（返回 Promise）
      // 必须先调用 getState 触发 OPEN -> HALF_OPEN 自动转换
      // （recordFailure 内部不调用 getState，不会自动转换状态）
      getState('worker-a');
      emit.mockClear();
      raise.mockClear();

      await recordFailure('worker-a');

      expect(raise).toHaveBeenCalledWith(
        'P0',
        'circuit_open_worker-a',
        expect.stringContaining('半开探针失败')
      );
    });
  });

  // ========== 超时后自动恢复 ==========
  describe('超时后自动恢复', () => {
    it('超时不足 30 分钟时保持 OPEN', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }

      // 只推进 29 分钟
      vi.advanceTimersByTime(OPEN_DURATION_MS - 60_000);

      expect(getState('worker-a').state).toBe('OPEN');
      expect(isAllowed('worker-a')).toBe(false);
    });

    it('恰好 30 分钟时转为 HALF_OPEN', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }

      vi.advanceTimersByTime(OPEN_DURATION_MS);

      expect(getState('worker-a').state).toBe('HALF_OPEN');
      expect(isAllowed('worker-a')).toBe(true);
    });

    it('超过 30 分钟也转为 HALF_OPEN', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }

      vi.advanceTimersByTime(OPEN_DURATION_MS + 60_000);

      expect(getState('worker-a').state).toBe('HALF_OPEN');
    });
  });

  // ========== 熔断器重置 ==========
  describe('熔断器重置（reset）', () => {
    it('reset 将状态恢复为默认', async () => {
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      expect(getState('worker-a').state).toBe('OPEN');

      reset('worker-a');

      const s = getState('worker-a');
      expect(s.state).toBe('CLOSED');
      expect(s.failures).toBe(0);
      expect(s.lastFailureAt).toBeNull();
      expect(s.openedAt).toBeNull();
    });

    it('reset 默认 key', async () => {
      await recordFailure();
      await recordFailure();
      expect(getState().failures).toBe(2);

      reset();

      expect(getState().failures).toBe(0);
    });

    it('reset 后允许派发', async () => {
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
      }
      expect(isAllowed('worker-a')).toBe(false);

      reset('worker-a');

      expect(isAllowed('worker-a')).toBe(true);
    });

    it('reset 一个 key 不影响其他 key', async () => {
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-a');
        await recordFailure('worker-b');
      }

      reset('worker-a');

      expect(isAllowed('worker-a')).toBe(true);
      expect(isAllowed('worker-b')).toBe(false);
    });
  });

  // ========== recordSuccess ==========
  describe('recordSuccess', () => {
    it('CLOSED 状态下成功不触发 circuit_closed 事件', async () => {
      await recordSuccess('worker-a');
      expect(emit).not.toHaveBeenCalled();
    });

    it('成功后清除失败计数', async () => {
      await recordFailure('worker-a');
      await recordFailure('worker-a');
      expect(getState('worker-a').failures).toBe(2);

      await recordSuccess('worker-a');
      expect(getState('worker-a').failures).toBe(0);
    });

    it('不传 key 时使用 default', async () => {
      await recordFailure();
      expect(getState().failures).toBe(1);

      await recordSuccess();
      expect(getState().failures).toBe(0);
    });
  });

  // ========== getAllStates ==========
  describe('getAllStates', () => {
    it('返回所有已注册的熔断器状态', async () => {
      // 触发一些状态
      await recordFailure('worker-a');
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('worker-b');
      }

      const all = getAllStates();

      // worker-a 和 worker-b 都应该在结果中
      expect(all['worker-a']).toBeDefined();
      expect(all['worker-b']).toBeDefined();

      expect(all['worker-a'].state).toBe('CLOSED');
      expect(all['worker-a'].failures).toBe(1);

      expect(all['worker-b'].state).toBe('OPEN');
      expect(all['worker-b'].failures).toBe(FAILURE_THRESHOLD);
    });

    it('返回的是对象类型', () => {
      const all = getAllStates();
      expect(typeof all).toBe('object');
    });

    it('每个 key 的状态包含完整字段', async () => {
      await recordFailure('test-key');
      const all = getAllStates();

      const s = all['test-key'];
      expect(s).toHaveProperty('state');
      expect(s).toHaveProperty('failures');
      expect(s).toHaveProperty('lastFailureAt');
      expect(s).toHaveProperty('openedAt');

      // 清理
      reset('test-key');
    });
  });

  // ========== 完整生命周期 ==========
  describe('完整生命周期', () => {
    it('CLOSED -> OPEN -> HALF_OPEN -> CLOSED（成功恢复）', async () => {
      vi.useFakeTimers();

      // 1. CLOSED 状态
      expect(getState('lifecycle').state).toBe('CLOSED');
      expect(isAllowed('lifecycle')).toBe(true);

      // 2. 累积失败 -> OPEN
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('lifecycle');
      }
      expect(getState('lifecycle').state).toBe('OPEN');
      expect(isAllowed('lifecycle')).toBe(false);

      // 3. 等待冷却 -> HALF_OPEN
      vi.advanceTimersByTime(OPEN_DURATION_MS);
      expect(getState('lifecycle').state).toBe('HALF_OPEN');
      expect(isAllowed('lifecycle')).toBe(true);

      // 4. 探针成功 -> CLOSED
      await recordSuccess('lifecycle');
      expect(getState('lifecycle').state).toBe('CLOSED');
      expect(isAllowed('lifecycle')).toBe(true);
      expect(getState('lifecycle').failures).toBe(0);

      // 清理
      reset('lifecycle');
    });

    it('CLOSED -> OPEN -> HALF_OPEN -> OPEN（探针失败）-> HALF_OPEN -> CLOSED', async () => {
      vi.useFakeTimers();

      // 1. 触发 OPEN
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure('lifecycle2');
      }
      expect(getState('lifecycle2').state).toBe('OPEN');

      // 2. 等待冷却 -> HALF_OPEN
      vi.advanceTimersByTime(OPEN_DURATION_MS);
      expect(getState('lifecycle2').state).toBe('HALF_OPEN');

      // 3. 探针失败 -> 回到 OPEN
      await recordFailure('lifecycle2');
      expect(getState('lifecycle2').state).toBe('OPEN');

      // 4. 再等 30 分钟 -> HALF_OPEN
      vi.advanceTimersByTime(OPEN_DURATION_MS);
      expect(getState('lifecycle2').state).toBe('HALF_OPEN');

      // 5. 这次探针成功 -> CLOSED
      await recordSuccess('lifecycle2');
      expect(getState('lifecycle2').state).toBe('CLOSED');

      // 清理
      reset('lifecycle2');
    });
  });
});
