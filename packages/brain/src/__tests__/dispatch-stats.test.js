/**
 * dispatch-stats.test.js
 * 派发成功率统计单元测试
 *
 * DoD 覆盖：
 * - 成功派发后更新 dispatch_stats
 * - 失败派发记录正确的 reason
 * - 1 小时滚动窗口过滤
 * - 多种失败原因统计
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeWindow1h,
  recordDispatchResult,
  WINDOW_MS
} from '../dispatch-stats.js';

// ─────────────────────────────────────────
// 纯函数测试（无需 mock）
// ─────────────────────────────────────────

describe('computeWindow1h - 纯函数', () => {
  const NOW = 1_700_000_000_000; // 固定时间戳（ms）

  it('空事件列表时返回 null rate 和零计数', () => {
    const result = computeWindow1h([], NOW);
    expect(result.total).toBe(0);
    expect(result.success).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.rate).toBeNull();
    expect(result.failure_reasons).toEqual({});
  });

  it('计算成功率 - 全部成功', () => {
    const events = [
      { ts: new Date(NOW - 1000).toISOString(), success: true },
      { ts: new Date(NOW - 2000).toISOString(), success: true },
    ];
    const result = computeWindow1h(events, NOW);
    expect(result.total).toBe(2);
    expect(result.success).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.rate).toBe(1);
  });

  it('计算成功率 - 混合结果（95%）', () => {
    const events = Array.from({ length: 100 }, (_, i) => ({
      ts: new Date(NOW - (i + 1) * 1000).toISOString(),
      success: i < 95,
      ...(i >= 95 ? { reason: 'circuit_breaker_open' } : {})
    }));
    const result = computeWindow1h(events, NOW);
    expect(result.total).toBe(100);
    expect(result.success).toBe(95);
    expect(result.failed).toBe(5);
    expect(result.rate).toBe(0.95);
    expect(result.failure_reasons['circuit_breaker_open']).toBe(5);
  });

  it('1 小时滚动窗口 - 过期事件不计入', () => {
    const events = [
      // 1 小时内的事件
      { ts: new Date(NOW - 30 * 60 * 1000).toISOString(), success: true },
      { ts: new Date(NOW - 59 * 60 * 1000).toISOString(), success: false, reason: 'draining' },
      // 超过 1 小时的事件（应被过滤）
      { ts: new Date(NOW - WINDOW_MS - 1000).toISOString(), success: false, reason: 'circuit_breaker_open' },
      { ts: new Date(NOW - WINDOW_MS - 60000).toISOString(), success: true },
    ];
    const result = computeWindow1h(events, NOW);
    expect(result.total).toBe(2);           // 只有 2 条在窗口内
    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failure_reasons['draining']).toBe(1);
    expect(result.failure_reasons['circuit_breaker_open']).toBeUndefined(); // 过期事件不计入
  });

  it('多种失败原因分别统计', () => {
    const events = [
      { ts: new Date(NOW - 1000).toISOString(), success: false, reason: 'circuit_breaker_open' },
      { ts: new Date(NOW - 2000).toISOString(), success: false, reason: 'circuit_breaker_open' },
      { ts: new Date(NOW - 3000).toISOString(), success: false, reason: 'pool_exhausted' },
      { ts: new Date(NOW - 4000).toISOString(), success: false, reason: 'billing_pause' },
      { ts: new Date(NOW - 5000).toISOString(), success: false, reason: 'pre_flight_check_failed' },
      { ts: new Date(NOW - 6000).toISOString(), success: false, reason: 'draining' },
      { ts: new Date(NOW - 7000).toISOString(), success: true },
    ];
    const result = computeWindow1h(events, NOW);
    expect(result.total).toBe(7);
    expect(result.failed).toBe(6);
    expect(result.failure_reasons['circuit_breaker_open']).toBe(2);
    expect(result.failure_reasons['pool_exhausted']).toBe(1);
    expect(result.failure_reasons['billing_pause']).toBe(1);
    expect(result.failure_reasons['pre_flight_check_failed']).toBe(1);
    expect(result.failure_reasons['draining']).toBe(1);
  });

  it('正好在窗口边界的事件（等于 cutoff）应被包含', () => {
    const events = [
      // cutoff = NOW - WINDOW_MS，正好在边界
      { ts: new Date(NOW - WINDOW_MS).toISOString(), success: true },
      // 稍微在边界内
      { ts: new Date(NOW - WINDOW_MS + 1).toISOString(), success: true },
    ];
    const result = computeWindow1h(events, NOW);
    expect(result.total).toBe(2); // 两条都在窗口内
  });
});

// ─────────────────────────────────────────
// recordDispatchResult 测试（mock pool）
// ─────────────────────────────────────────

describe('recordDispatchResult - DB 操作', () => {
  const NOW = 1_700_000_000_000;
  let mockPool;

  beforeEach(() => {
    mockPool = {
      query: vi.fn()
    };
  });

  it('成功派发后：写入成功事件并更新 window_1h', async () => {
    // 模拟 DB 中无数据（第一次调用返回空）
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })   // readDispatchStats
      .mockResolvedValueOnce({ rows: [] }); // writeDispatchStats

    await recordDispatchResult(mockPool, true, null, NOW);

    // 验证写入调用
    const writeCall = mockPool.query.mock.calls[1];
    expect(writeCall[0]).toContain('INSERT INTO working_memory');
    const written = writeCall[1][1]; // value_json 参数
    expect(written.events).toHaveLength(1);
    expect(written.events[0].success).toBe(true);
    expect(written.events[0].reason).toBeUndefined();
    expect(written.window_1h.total).toBe(1);
    expect(written.window_1h.success).toBe(1);
    expect(written.window_1h.rate).toBe(1);
  });

  it('失败派发后：写入正确的 reason 并更新 window_1h', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await recordDispatchResult(mockPool, false, 'circuit_breaker_open', NOW);

    const writeCall = mockPool.query.mock.calls[1];
    const written = writeCall[1][1];
    expect(written.events[0].success).toBe(false);
    expect(written.events[0].reason).toBe('circuit_breaker_open');
    expect(written.window_1h.failed).toBe(1);
    expect(written.window_1h.failure_reasons['circuit_breaker_open']).toBe(1);
  });

  it('滚动窗口：追加新事件后，过期事件被裁剪', async () => {
    // 模拟 DB 中已有一条过期事件
    const expiredEvent = {
      ts: new Date(NOW - WINDOW_MS - 5000).toISOString(),
      success: false,
      reason: 'draining'
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ value_json: { events: [expiredEvent] } }] })
      .mockResolvedValueOnce({ rows: [] });

    await recordDispatchResult(mockPool, true, null, NOW);

    const writeCall = mockPool.query.mock.calls[1];
    const written = writeCall[1][1];
    // 过期事件被裁剪，只剩新的成功事件
    expect(written.events).toHaveLength(1);
    expect(written.events[0].success).toBe(true);
    expect(written.window_1h.total).toBe(1);
  });

  it('多种失败原因：累积统计正确', async () => {
    // 模拟 DB 中已有 pool_exhausted 事件
    const existingEvent = {
      ts: new Date(NOW - 60 * 1000).toISOString(),
      success: false,
      reason: 'pool_exhausted'
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ value_json: { events: [existingEvent] } }] })
      .mockResolvedValueOnce({ rows: [] });

    // 追加一条 billing_pause 失败
    await recordDispatchResult(mockPool, false, 'billing_pause', NOW);

    const writeCall = mockPool.query.mock.calls[1];
    const written = writeCall[1][1];
    expect(written.events).toHaveLength(2);
    expect(written.window_1h.total).toBe(2);
    expect(written.window_1h.failed).toBe(2);
    expect(written.window_1h.failure_reasons['pool_exhausted']).toBe(1);
    expect(written.window_1h.failure_reasons['billing_pause']).toBe(1);
  });

  it('DB 错误时不影响调用方（静默吞掉异常）', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    // 不应该抛出异常
    await expect(recordDispatchResult(mockPool, true, null, NOW)).resolves.toBeUndefined();
  });
});
