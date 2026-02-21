/**
 * Circuit Breaker State Machine - 集成测试
 *
 * DoD 映射：
 *   DoD #1: 熔断三态转换集成测试（CLOSED→OPEN→HALF_OPEN→CLOSED 完整流程）
 *
 * 验证完整状态机流转：
 *   CLOSED (正常) → OPEN (触发阈值) → HALF_OPEN (冷却后) → CLOSED (恢复成功)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));
vi.mock('../event-bus.js', () => ({
  emit: vi.fn()
}));
vi.mock('../notifier.js', () => ({
  notifyCircuitOpen: vi.fn().mockResolvedValue(undefined)
}));

import {
  getState,
  isAllowed,
  recordSuccess,
  recordFailure,
  reset,
  FAILURE_THRESHOLD,
  OPEN_DURATION_MS
} from '../circuit-breaker.js';
import { emit } from '../event-bus.js';

describe('Circuit Breaker State Machine（集成测试）', () => {
  const KEY = 'integration-test-sm';

  beforeEach(() => {
    vi.clearAllMocks();
    reset(KEY);
    vi.useRealTimers();
  });

  afterEach(() => {
    reset(KEY);
    vi.useRealTimers();
  });

  it('完整三态转换流程 CLOSED→OPEN→HALF_OPEN→CLOSED', async () => {
    // === 阶段 1: CLOSED 初始状态 ===
    const initial = getState(KEY);
    expect(initial.state).toBe('CLOSED');
    expect(initial.failures).toBe(0);
    expect(isAllowed(KEY)).toBe(true);

    // === 阶段 2: CLOSED → OPEN（触发失败阈值）===
    // 记录 FAILURE_THRESHOLD 次失败
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await recordFailure(KEY);
    }

    const openState = getState(KEY);
    expect(openState.state).toBe('OPEN');
    expect(openState.failures).toBe(FAILURE_THRESHOLD);
    expect(openState.openedAt).not.toBeNull();
    expect(isAllowed(KEY)).toBe(false);

    // 验证 circuit_open 事件已触发
    expect(emit).toHaveBeenCalledWith(
      'circuit_open',
      'circuit_breaker',
      expect.objectContaining({
        key: KEY,
        reason: 'failure_threshold_reached'
      })
    );

    // === 阶段 3: OPEN → HALF_OPEN（冷却期结束）===
    vi.useFakeTimers();

    // 重新触发，因为 fake timers 需要在 reset 之后重建状态
    reset(KEY);
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await recordFailure(KEY);
    }
    expect(getState(KEY).state).toBe('OPEN');
    expect(isAllowed(KEY)).toBe(false);

    // 推进时钟超过冷却时间（OPEN_DURATION_MS = 30分钟）
    vi.advanceTimersByTime(OPEN_DURATION_MS + 1000);

    // OPEN → HALF_OPEN 自动转换
    const halfOpenState = getState(KEY);
    expect(halfOpenState.state).toBe('HALF_OPEN');
    expect(isAllowed(KEY)).toBe(true); // HALF_OPEN 允许探针请求

    // === 阶段 4: HALF_OPEN → CLOSED（探针成功）===
    await recordSuccess(KEY);

    const closedState = getState(KEY);
    expect(closedState.state).toBe('CLOSED');
    expect(closedState.failures).toBe(0);
    expect(closedState.openedAt).toBeNull();
    expect(isAllowed(KEY)).toBe(true);

    // 验证 circuit_closed 事件已触发
    expect(emit).toHaveBeenCalledWith(
      'circuit_closed',
      'circuit_breaker',
      expect.objectContaining({
        key: KEY,
        previous_state: 'HALF_OPEN'
      })
    );

    vi.useRealTimers();
  });

  it('HALF_OPEN 探针失败时回退到 OPEN', async () => {
    vi.useFakeTimers();

    // 触发 OPEN 状态
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await recordFailure(KEY);
    }
    expect(getState(KEY).state).toBe('OPEN');

    // 等待冷却进入 HALF_OPEN
    vi.advanceTimersByTime(OPEN_DURATION_MS + 1000);
    expect(getState(KEY).state).toBe('HALF_OPEN');

    // 探针失败 → 回退到 OPEN
    await recordFailure(KEY);
    expect(getState(KEY).state).toBe('OPEN');
    expect(isAllowed(KEY)).toBe(false);

    // 验证 half_open_probe_failed 事件
    expect(emit).toHaveBeenCalledWith(
      'circuit_open',
      'circuit_breaker',
      expect.objectContaining({
        key: KEY,
        reason: 'half_open_probe_failed'
      })
    );

    vi.useRealTimers();
  });

  it('CLOSED 状态下成功重置失败计数', async () => {
    // 部分失败（未触发阈值）
    await recordFailure(KEY);
    await recordFailure(KEY);
    expect(getState(KEY).state).toBe('CLOSED');
    expect(getState(KEY).failures).toBe(2);

    // 成功 → 重置
    await recordSuccess(KEY);
    expect(getState(KEY).failures).toBe(0);
    expect(getState(KEY).state).toBe('CLOSED');
  });
});
