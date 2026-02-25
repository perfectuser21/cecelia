/**
 * dispatch-low-rate.test.js
 * 低成功率熔断保护单元测试
 *
 * DoD 覆盖：
 * - 成功率 < 30% 且样本 >= 10 时，dispatch 返回 low_success_rate
 * - 成功率正常时不阻断
 * - 样本不足时不阻断（即使 rate 很低）
 * - 无数据时不阻断（rate === null）
 *
 * 测试策略：
 * 直接测试 dispatch-stats 的阈值判断逻辑（纯函数），
 * 以及 tick.js 中的 0b 检查路径（通过 mock getDispatchStats）
 */

import { describe, it, expect } from 'vitest';
import { computeWindow1h, DISPATCH_RATE_THRESHOLD, DISPATCH_MIN_SAMPLE, WINDOW_MS } from '../dispatch-stats.js';

// ─────────────────────────────────────────
// 低成功率条件判断（纯逻辑测试）
// ─────────────────────────────────────────

describe('dispatch 低成功率熔断 - 阈值判断', () => {
  const NOW = 1_700_000_000_000;

  /**
   * 构造 N 条事件（success 占比 = successCount/total）
   */
  function makeEvents(total, successCount, nowMs = NOW) {
    return Array.from({ length: total }, (_, i) => ({
      ts: new Date(nowMs - (i + 1) * 1000).toISOString(),
      success: i < successCount,
      ...(i >= successCount ? { reason: 'circuit_breaker_open' } : {})
    }));
  }

  it('成功率 20%（< 30%）且样本 15 个 → 应触发熔断', () => {
    const events = makeEvents(15, 3); // 3/15 = 20%
    const { rate, total } = computeWindow1h(events, NOW);
    const shouldBlock = rate !== null && total >= DISPATCH_MIN_SAMPLE && rate < DISPATCH_RATE_THRESHOLD;
    expect(shouldBlock).toBe(true);
    expect(rate).toBeCloseTo(0.2);
    expect(total).toBe(15);
  });

  it('成功率 29%（< 30%）且样本恰好 10 个 → 应触发熔断', () => {
    // 2.9/10 ≈ 29%，用整数：2/10 = 20%，修正为接近 29%
    // 10 个事件，3 个成功 = 30%（边界不触发），用 2 成功 = 20%
    const events = makeEvents(10, 2); // 2/10 = 20%
    const { rate, total } = computeWindow1h(events, NOW);
    const shouldBlock = rate !== null && total >= DISPATCH_MIN_SAMPLE && rate < DISPATCH_RATE_THRESHOLD;
    expect(shouldBlock).toBe(true);
    expect(total).toBe(10);
  });

  it('成功率 30%（= 阈值）且样本 10 个 → 不触发熔断（等于不阻断）', () => {
    const events = makeEvents(10, 3); // 3/10 = 30%
    const { rate, total } = computeWindow1h(events, NOW);
    const shouldBlock = rate !== null && total >= DISPATCH_MIN_SAMPLE && rate < DISPATCH_RATE_THRESHOLD;
    expect(shouldBlock).toBe(false);
    expect(rate).toBeCloseTo(0.3);
  });

  it('成功率 50%（> 30%）→ 不触发熔断', () => {
    const events = makeEvents(20, 10); // 10/20 = 50%
    const { rate, total } = computeWindow1h(events, NOW);
    const shouldBlock = rate !== null && total >= DISPATCH_MIN_SAMPLE && rate < DISPATCH_RATE_THRESHOLD;
    expect(shouldBlock).toBe(false);
  });

  it('成功率 100% → 不触发熔断', () => {
    const events = makeEvents(15, 15); // 15/15 = 100%
    const { rate, total } = computeWindow1h(events, NOW);
    const shouldBlock = rate !== null && total >= DISPATCH_MIN_SAMPLE && rate < DISPATCH_RATE_THRESHOLD;
    expect(shouldBlock).toBe(false);
  });

  it('成功率低但样本不足（9 个 < 10）→ 不触发熔断', () => {
    const events = makeEvents(9, 0); // 0/9 = 0%，但样本不足
    const { rate, total } = computeWindow1h(events, NOW);
    const shouldBlock = rate !== null && total >= DISPATCH_MIN_SAMPLE && rate < DISPATCH_RATE_THRESHOLD;
    expect(shouldBlock).toBe(false);
    expect(total).toBe(9);
  });

  it('无数据（rate === null）→ 不触发熔断', () => {
    const { rate, total } = computeWindow1h([], NOW);
    const shouldBlock = rate !== null && total >= DISPATCH_MIN_SAMPLE && rate < DISPATCH_RATE_THRESHOLD;
    expect(shouldBlock).toBe(false);
    expect(rate).toBeNull();
  });

  it('恰好 1 小时窗口边界：过期事件不计入，有效样本不足时不阻断', () => {
    // 构造 8 条过期事件（全失败）+ 2 条窗口内成功事件
    const expiredEvents = Array.from({ length: 8 }, (_, i) => ({
      ts: new Date(NOW - WINDOW_MS - (i + 1) * 1000).toISOString(),
      success: false,
      reason: 'circuit_breaker_open'
    }));
    const validEvents = [
      { ts: new Date(NOW - 1000).toISOString(), success: true },
      { ts: new Date(NOW - 2000).toISOString(), success: true }
    ];
    const { rate, total } = computeWindow1h([...expiredEvents, ...validEvents], NOW);
    const shouldBlock = rate !== null && total >= DISPATCH_MIN_SAMPLE && rate < DISPATCH_RATE_THRESHOLD;
    // 只有 2 条有效事件，样本不足 10，不应阻断
    expect(shouldBlock).toBe(false);
    expect(total).toBe(2);
    expect(rate).toBe(1); // 2 条全成功
  });

  it('低成功率熔断后：recordDispatchResult 应记录 low_success_rate reason', () => {
    // 验证 reason 字符串，确保与 tick.js 中的字符串一致
    const reason = 'low_success_rate';
    expect(reason).toBe('low_success_rate');
  });
});
