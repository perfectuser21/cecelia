/**
 * dispatch-stats.test.js
 * 派发成功率统计单元测试（完整覆盖）
 *
 * 覆盖范围：
 * - 常量导出验证
 * - readDispatchStats（正常读取、空结果、旧格式兼容）
 * - writeDispatchStats（UPSERT 写入）
 * - computeWindow1h（纯函数：空列表、全成功、混合、过期过滤、多失败原因、边界）
 * - recordDispatchResult（成功/失败记录、滚动裁剪、累积统计、DB 错误静默）
 * - getDispatchStats（实时计算、空数据、过期过滤）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DISPATCH_STATS_KEY,
  WINDOW_MS,
  DISPATCH_RATE_THRESHOLD,
  DISPATCH_MIN_SAMPLE,
  readDispatchStats,
  writeDispatchStats,
  computeWindow1h,
  recordDispatchResult,
  getDispatchStats,
} from '../dispatch-stats.js';

// ─────────────────────────────────────────
// 辅助：创建 mock pool
// ─────────────────────────────────────────

function makeMockPool() {
  return {
    query: vi.fn(),
  };
}

// ─────────────────────────────────────────
// 常量导出验证
// ─────────────────────────────────────────

describe('常量导出', () => {
  it('DISPATCH_STATS_KEY 应为 "dispatch_stats"', () => {
    expect(DISPATCH_STATS_KEY).toBe('dispatch_stats');
  });

  it('WINDOW_MS 应为 1 小时（3600000 ms）', () => {
    expect(WINDOW_MS).toBe(60 * 60 * 1000);
  });

  it('DISPATCH_RATE_THRESHOLD 应为 0.3（30%）', () => {
    expect(DISPATCH_RATE_THRESHOLD).toBe(0.3);
  });

  it('DISPATCH_MIN_SAMPLE 应为 10', () => {
    expect(DISPATCH_MIN_SAMPLE).toBe(10);
  });
});

// ─────────────────────────────────────────
// readDispatchStats 测试
// ─────────────────────────────────────────

describe('readDispatchStats', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = makeMockPool();
  });

  it('DB 中无数据时返回 { events: [] }', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await readDispatchStats(mockPool);
    expect(result).toEqual({ events: [] });

    // 验证 SQL 参数
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT value_json FROM working_memory'),
      [DISPATCH_STATS_KEY]
    );
  });

  it('DB 中有数据时返回 value_json', async () => {
    const stored = {
      events: [{ ts: '2026-01-01T00:00:00.000Z', success: true }],
      window_1h: { total: 1, success: 1, failed: 0, rate: 1 },
    };
    mockPool.query.mockResolvedValueOnce({ rows: [{ value_json: stored }] });

    const result = await readDispatchStats(mockPool);
    expect(result).toEqual(stored);
  });

  it('旧格式兼容：value_json 没有 events 字段时自动补空数组', async () => {
    const oldFormat = { window_1h: { total: 5 } };
    mockPool.query.mockResolvedValueOnce({ rows: [{ value_json: oldFormat }] });

    const result = await readDispatchStats(mockPool);
    expect(result.events).toEqual([]);
    expect(result.window_1h).toEqual({ total: 5 });
  });
});

// ─────────────────────────────────────────
// writeDispatchStats 测试
// ─────────────────────────────────────────

describe('writeDispatchStats', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = makeMockPool();
  });

  it('使用 UPSERT 写入 working_memory', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const data = { events: [], window_1h: { total: 0 } };
    await writeDispatchStats(mockPool, data);

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO working_memory');
    expect(sql).toContain('ON CONFLICT');
    expect(params[0]).toBe(DISPATCH_STATS_KEY);
    expect(params[1]).toEqual(data);
  });

  it('DB 写入失败时抛出异常（不吞错误）', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('写入失败'));

    await expect(
      writeDispatchStats(mockPool, { events: [] })
    ).rejects.toThrow('写入失败');
  });
});

// ─────────────────────────────────────────
// computeWindow1h 纯函数测试
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

  it('计算成功率 - 全部失败', () => {
    const events = [
      { ts: new Date(NOW - 1000).toISOString(), success: false, reason: 'err_a' },
      { ts: new Date(NOW - 2000).toISOString(), success: false, reason: 'err_b' },
    ];
    const result = computeWindow1h(events, NOW);
    expect(result.total).toBe(2);
    expect(result.success).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.rate).toBe(0);
    expect(result.failure_reasons).toEqual({ err_a: 1, err_b: 1 });
  });

  it('计算成功率 - 混合结果（95%）', () => {
    const events = Array.from({ length: 100 }, (_, i) => ({
      ts: new Date(NOW - (i + 1) * 1000).toISOString(),
      success: i < 95,
      ...(i >= 95 ? { reason: 'circuit_breaker_open' } : {}),
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
      // 窗口内
      { ts: new Date(NOW - 30 * 60 * 1000).toISOString(), success: true },
      { ts: new Date(NOW - 59 * 60 * 1000).toISOString(), success: false, reason: 'draining' },
      // 窗口外
      { ts: new Date(NOW - WINDOW_MS - 1000).toISOString(), success: false, reason: 'circuit_breaker_open' },
      { ts: new Date(NOW - WINDOW_MS - 60000).toISOString(), success: true },
    ];
    const result = computeWindow1h(events, NOW);
    expect(result.total).toBe(2);
    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failure_reasons['draining']).toBe(1);
    expect(result.failure_reasons['circuit_breaker_open']).toBeUndefined();
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
      { ts: new Date(NOW - WINDOW_MS).toISOString(), success: true },
      { ts: new Date(NOW - WINDOW_MS + 1).toISOString(), success: true },
    ];
    const result = computeWindow1h(events, NOW);
    expect(result.total).toBe(2);
  });

  it('失败但无 reason 的事件不计入 failure_reasons', () => {
    const events = [
      { ts: new Date(NOW - 1000).toISOString(), success: false },
      { ts: new Date(NOW - 2000).toISOString(), success: false, reason: 'some_err' },
    ];
    const result = computeWindow1h(events, NOW);
    expect(result.failed).toBe(2);
    expect(result.failure_reasons).toEqual({ some_err: 1 });
  });
});

// ─────────────────────────────────────────
// recordDispatchResult 测试（mock pool）
// ─────────────────────────────────────────

describe('recordDispatchResult - DB 操作', () => {
  const NOW = 1_700_000_000_000;
  let mockPool;

  beforeEach(() => {
    mockPool = makeMockPool();
  });

  it('成功派发后：写入成功事件并更新 window_1h', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })   // readDispatchStats
      .mockResolvedValueOnce({ rows: [] });   // writeDispatchStats

    await recordDispatchResult(mockPool, true, null, NOW);

    const writeCall = mockPool.query.mock.calls[1];
    expect(writeCall[0]).toContain('INSERT INTO working_memory');
    const written = writeCall[1][1];
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

  it('失败但 reason 为 null 时事件不包含 reason 字段', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await recordDispatchResult(mockPool, false, null, NOW);

    const writeCall = mockPool.query.mock.calls[1];
    const written = writeCall[1][1];
    expect(written.events[0].success).toBe(false);
    expect(written.events[0]).not.toHaveProperty('reason');
  });

  it('滚动窗口：追加新事件后，过期事件被裁剪', async () => {
    const expiredEvent = {
      ts: new Date(NOW - WINDOW_MS - 5000).toISOString(),
      success: false,
      reason: 'draining',
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ value_json: { events: [expiredEvent] } }] })
      .mockResolvedValueOnce({ rows: [] });

    await recordDispatchResult(mockPool, true, null, NOW);

    const writeCall = mockPool.query.mock.calls[1];
    const written = writeCall[1][1];
    expect(written.events).toHaveLength(1);
    expect(written.events[0].success).toBe(true);
    expect(written.window_1h.total).toBe(1);
  });

  it('多种失败原因：累积统计正确', async () => {
    const existingEvent = {
      ts: new Date(NOW - 60 * 1000).toISOString(),
      success: false,
      reason: 'pool_exhausted',
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ value_json: { events: [existingEvent] } }] })
      .mockResolvedValueOnce({ rows: [] });

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

    await expect(recordDispatchResult(mockPool, true, null, NOW)).resolves.toBeUndefined();
  });

  it('不传 nowMs 时使用 Date.now()', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const before = Date.now();
    await recordDispatchResult(mockPool, true);
    const after = Date.now();

    const writeCall = mockPool.query.mock.calls[1];
    const written = writeCall[1][1];
    const eventTs = new Date(written.events[0].ts).getTime();
    expect(eventTs).toBeGreaterThanOrEqual(before);
    expect(eventTs).toBeLessThanOrEqual(after);
  });

  it('window_1h 包含 last_updated 字段', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await recordDispatchResult(mockPool, true, null, NOW);

    const writeCall = mockPool.query.mock.calls[1];
    const written = writeCall[1][1];
    expect(written.window_1h.last_updated).toBe(new Date(NOW).toISOString());
  });
});

// ─────────────────────────────────────────
// getDispatchStats 测试
// ─────────────────────────────────────────

describe('getDispatchStats', () => {
  const NOW = 1_700_000_000_000;
  let mockPool;

  beforeEach(() => {
    mockPool = makeMockPool();
  });

  it('DB 无数据时返回空窗口统计', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getDispatchStats(mockPool, NOW);
    expect(result.window_1h.total).toBe(0);
    expect(result.window_1h.success).toBe(0);
    expect(result.window_1h.failed).toBe(0);
    expect(result.window_1h.rate).toBeNull();
    expect(result.window_1h.failure_reasons).toEqual({});
    expect(result.window_1h.last_updated).toBe(new Date(NOW).toISOString());
  });

  it('有数据时实时计算窗口统计', async () => {
    const events = [
      { ts: new Date(NOW - 1000).toISOString(), success: true },
      { ts: new Date(NOW - 2000).toISOString(), success: true },
      { ts: new Date(NOW - 3000).toISOString(), success: false, reason: 'err' },
    ];
    mockPool.query.mockResolvedValueOnce({ rows: [{ value_json: { events } }] });

    const result = await getDispatchStats(mockPool, NOW);
    expect(result.window_1h.total).toBe(3);
    expect(result.window_1h.success).toBe(2);
    expect(result.window_1h.failed).toBe(1);
    expect(result.window_1h.rate).toBeCloseTo(2 / 3);
    expect(result.window_1h.failure_reasons).toEqual({ err: 1 });
  });

  it('过期事件在实时计算时被排除', async () => {
    const events = [
      { ts: new Date(NOW - 1000).toISOString(), success: true },
      { ts: new Date(NOW - WINDOW_MS - 1000).toISOString(), success: false, reason: 'old' },
    ];
    mockPool.query.mockResolvedValueOnce({ rows: [{ value_json: { events } }] });

    const result = await getDispatchStats(mockPool, NOW);
    expect(result.window_1h.total).toBe(1);
    expect(result.window_1h.success).toBe(1);
    expect(result.window_1h.failure_reasons['old']).toBeUndefined();
  });

  it('不传 nowMs 时使用 Date.now()', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const before = Date.now();
    const result = await getDispatchStats(mockPool);
    const after = Date.now();

    const lastUpdated = new Date(result.window_1h.last_updated).getTime();
    expect(lastUpdated).toBeGreaterThanOrEqual(before);
    expect(lastUpdated).toBeLessThanOrEqual(after);
  });

  it('返回结构只包含 window_1h（不暴露原始 events）', async () => {
    const events = [
      { ts: new Date(NOW - 1000).toISOString(), success: true },
    ];
    mockPool.query.mockResolvedValueOnce({ rows: [{ value_json: { events } }] });

    const result = await getDispatchStats(mockPool, NOW);
    expect(result).toHaveProperty('window_1h');
    expect(result).not.toHaveProperty('events');
  });

  it('DB 读取失败时抛出异常（getDispatchStats 不吞错误）', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB timeout'));

    await expect(getDispatchStats(mockPool, NOW)).rejects.toThrow('DB timeout');
  });
});
