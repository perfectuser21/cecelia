/**
 * stats.test.js
 * PR 统计查询模块单元测试
 *
 * DoD 覆盖：
 * - getMonthlyPRCount: 查询指定月份完成的 dev 任务数量
 * - getMonthlyPRsByKR: 按 KR (goal_id) 过滤
 * - getPRSuccessRate: 成功率计算，无数据返回 null
 * - getPRTrend: 最近 N 天每日趋势
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getMonthlyPRCount,
  getMonthlyPRsByKR,
  getPRSuccessRate,
  getPRTrend,
} from '../stats.js';

// ─────────────────────────────────────────
// Mock pool 工厂
// ─────────────────────────────────────────

function makePool(queryFn) {
  return { query: vi.fn(queryFn) };
}

// ─────────────────────────────────────────
// getMonthlyPRCount
// ─────────────────────────────────────────

describe('getMonthlyPRCount', () => {
  it('返回数字类型', async () => {
    const pool = makePool(async () => ({ rows: [{ count: '5' }] }));
    const result = await getMonthlyPRCount(pool, 3, 2026);
    expect(typeof result).toBe('number');
    expect(result).toBe(5);
  });

  it('无数据时返回 0', async () => {
    const pool = makePool(async () => ({ rows: [{ count: '0' }] }));
    const result = await getMonthlyPRCount(pool, 1, 2026);
    expect(result).toBe(0);
  });

  it('空 rows 时返回 0', async () => {
    const pool = makePool(async () => ({ rows: [] }));
    const result = await getMonthlyPRCount(pool, 1, 2026);
    expect(result).toBe(0);
  });

  it('使用正确的 SQL 过滤条件（status=completed, task_type=dev）', async () => {
    const pool = makePool(async () => ({ rows: [{ count: '3' }] }));
    await getMonthlyPRCount(pool, 3, 2026);
    const callArgs = pool.query.mock.calls[0];
    const sql = callArgs[0];
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("task_type = 'dev'");
    expect(sql).toContain('completed_at');
  });

  it('日期范围参数正确传入（月初到月末）', async () => {
    const pool = makePool(async () => ({ rows: [{ count: '2' }] }));
    await getMonthlyPRCount(pool, 3, 2026);
    const params = pool.query.mock.calls[0][1];
    const startDate = new Date(params[0]);
    const endDate = new Date(params[1]);
    expect(startDate.getMonth()).toBe(2); // 3月 = index 2
    expect(startDate.getDate()).toBe(1);
    expect(endDate.getMonth()).toBe(3); // 4月初 = index 3
    expect(endDate.getDate()).toBe(1);
  });

  it('12 月边界正确（年末跨年）', async () => {
    const pool = makePool(async () => ({ rows: [{ count: '1' }] }));
    await getMonthlyPRCount(pool, 12, 2025);
    const params = pool.query.mock.calls[0][1];
    const endDate = new Date(params[1]);
    expect(endDate.getFullYear()).toBe(2026);
    expect(endDate.getMonth()).toBe(0); // 1月 = index 0
  });
});

// ─────────────────────────────────────────
// getMonthlyPRsByKR
// ─────────────────────────────────────────

describe('getMonthlyPRsByKR', () => {
  const KR_ID = '550e8400-e29b-41d4-a716-446655440000';

  it('通过 goal_id 过滤', async () => {
    const pool = makePool(async () => ({ rows: [{ count: '4' }] }));
    await getMonthlyPRsByKR(pool, KR_ID, 3, 2026);
    const callArgs = pool.query.mock.calls[0];
    const sql = callArgs[0];
    const params = callArgs[1];
    expect(sql).toContain('goal_id = $1');
    expect(params[0]).toBe(KR_ID);
  });

  it('返回正确数量', async () => {
    const pool = makePool(async () => ({ rows: [{ count: '7' }] }));
    const result = await getMonthlyPRsByKR(pool, KR_ID, 3, 2026);
    expect(result).toBe(7);
  });

  it('kr_id 无数据时返回 0（不抛错）', async () => {
    const pool = makePool(async () => ({ rows: [{ count: '0' }] }));
    const result = await getMonthlyPRsByKR(pool, 'nonexistent-id', 3, 2026);
    expect(result).toBe(0);
  });

  it('空 rows 时返回 0', async () => {
    const pool = makePool(async () => ({ rows: [] }));
    const result = await getMonthlyPRsByKR(pool, KR_ID, 3, 2026);
    expect(result).toBe(0);
  });
});

// ─────────────────────────────────────────
// getPRSuccessRate
// ─────────────────────────────────────────

describe('getPRSuccessRate', () => {
  it('正确计算成功率 (80%)', async () => {
    const pool = makePool(async () => ({
      rows: [{ completed_count: '8', failed_count: '2' }],
    }));
    const rate = await getPRSuccessRate(pool, 3, 2026);
    expect(rate).toBe(0.8);
  });

  it('全部成功时返回 1', async () => {
    const pool = makePool(async () => ({
      rows: [{ completed_count: '10', failed_count: '0' }],
    }));
    const rate = await getPRSuccessRate(pool, 3, 2026);
    expect(rate).toBe(1);
  });

  it('全部失败时返回 0', async () => {
    const pool = makePool(async () => ({
      rows: [{ completed_count: '0', failed_count: '5' }],
    }));
    const rate = await getPRSuccessRate(pool, 3, 2026);
    expect(rate).toBe(0);
  });

  it('无数据时返回 null', async () => {
    const pool = makePool(async () => ({
      rows: [{ completed_count: '0', failed_count: '0' }],
    }));
    const rate = await getPRSuccessRate(pool, 3, 2026);
    expect(rate).toBeNull();
  });

  it('空 rows 时返回 null', async () => {
    const pool = makePool(async () => ({ rows: [] }));
    const rate = await getPRSuccessRate(pool, 3, 2026);
    expect(rate).toBeNull();
  });
});

// ─────────────────────────────────────────
// getPRTrend
// ─────────────────────────────────────────

describe('getPRTrend', () => {
  it('返回日期-数量数组', async () => {
    const pool = makePool(async () => ({
      rows: [
        { date: '2026-03-01', count: '3' },
        { date: '2026-03-02', count: '5' },
      ],
    }));
    const result = await getPRTrend(pool, 7);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ date: '2026-03-01', count: 3 });
    expect(result[1]).toEqual({ date: '2026-03-02', count: 5 });
  });

  it('无数据时返回空数组', async () => {
    const pool = makePool(async () => ({ rows: [] }));
    const result = await getPRTrend(pool, 30);
    expect(result).toEqual([]);
  });

  it('days 参数默认 30', async () => {
    const pool = makePool(async () => ({ rows: [] }));
    await getPRTrend(pool);
    const params = pool.query.mock.calls[0][1];
    const startDate = new Date(params[0]);
    const diffDays = Math.round((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    // 允许 ±1 天误差（时区和时间点差异）
    expect(diffDays).toBeGreaterThanOrEqual(29);
    expect(diffDays).toBeLessThanOrEqual(31);
  });

  it('days 超出范围（>365）被限制到 365', async () => {
    const pool = makePool(async () => ({ rows: [] }));
    await getPRTrend(pool, 999);
    const params = pool.query.mock.calls[0][1];
    const startDate = new Date(params[0]);
    const diffDays = Math.round((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    // 最多 365 天
    expect(diffDays).toBeLessThanOrEqual(366);
    expect(diffDays).toBeGreaterThanOrEqual(364);
  });

  it('days 小于 1 被限制到 1', async () => {
    const pool = makePool(async () => ({ rows: [] }));
    await getPRTrend(pool, 0);
    const params = pool.query.mock.calls[0][1];
    const startDate = new Date(params[0]);
    const diffDays = Math.round((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBeLessThanOrEqual(2);
  });

  it('Date 对象类型的 date 字段被格式化为 YYYY-MM-DD', async () => {
    const dateObj = new Date('2026-03-15T00:00:00.000Z');
    const pool = makePool(async () => ({
      rows: [{ date: dateObj, count: '2' }],
    }));
    const result = await getPRTrend(pool, 30);
    expect(result[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
