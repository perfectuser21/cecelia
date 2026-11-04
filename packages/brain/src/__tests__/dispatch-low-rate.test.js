/** 真实派发统计窗口回归；不宣称旧低成功率调度闸已启用。 */
import { describe, it, expect } from 'vitest';
import { computeWindow1h, WINDOW_MS } from '../dispatch-stats.js';

// ─────────────────────────────────────────
// 低成功率条件判断（纯逻辑测试）
// ─────────────────────────────────────────

describe('dispatch 最近一小时统计窗口', () => {
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

  it('15样本3成功的窗口比例为20%', () => {
    const events = makeEvents(15, 3); // 3/15 = 20%
    const { rate, total } = computeWindow1h(events, NOW);
    expect(rate).toBeCloseTo(0.2);
    expect(total).toBe(15);
  });

  it('10样本2成功的窗口比例为20%', () => {
    const events = makeEvents(10, 2); // 2/10 = 20%
    const { rate, total } = computeWindow1h(events, NOW);
    expect(total).toBe(10);
    expect(rate).toBe(0.2);
  });

  it('10样本3成功的窗口比例为30%', () => {
    const events = makeEvents(10, 3); // 3/10 = 30%
    const { rate, total } = computeWindow1h(events, NOW);
    expect(rate).toBeCloseTo(0.3);
  });

  it('20样本10成功的窗口比例为50%', () => {
    const events = makeEvents(20, 10); // 10/20 = 50%
    const { rate, total } = computeWindow1h(events, NOW);
    expect(total).toBe(events.length);
    expect(rate).toBe(events.filter(e => e.success).length / events.length);
  });

  it('全成功窗口比例为100%', () => {
    const events = makeEvents(15, 15); // 15/15 = 100%
    const { rate, total } = computeWindow1h(events, NOW);
    expect(total).toBe(events.length);
    expect(rate).toBe(events.filter(e => e.success).length / events.length);
  });

  it('9样本全失败的窗口比例为0%', () => {
    const events = makeEvents(9, 0); // 0/9 = 0%，但样本不足
    const { rate, total } = computeWindow1h(events, NOW);
    expect(total).toBe(9);
    expect(rate).toBe(0);
  });

  it('无数据的比例为null', () => {
    const { rate, total } = computeWindow1h([], NOW);
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
    // 只有 2 条有效事件，样本不足 10，不应阻断
    expect(total).toBe(2);
    expect(rate).toBe(1); // 2 条全成功
  });

});
