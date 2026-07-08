/**
 * tick-stats — tick 统计写入活路径模块（Wave-2 断链修复）。
 * 背景：tick_execution_stats/tick_last/tick_actions_today 的写入方在废弃的
 * executeTick 体内，runScheduler 活路径从不写 → 三 key 冻在 2026-05-05。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

import { recordTickExecution, incrementActionsToday } from '../tick-stats.js';

function makeClient(existingStats) {
  const client = { query: vi.fn(), release: vi.fn() };
  client.query.mockImplementation(async (sql) => {
    if (/FOR UPDATE/.test(sql)) return { rows: existingStats ? [{ value_json: existingStats }] : [] };
    return { rows: [] };
  });
  return client;
}

beforeEach(() => { mockPool.query.mockReset(); mockPool.connect.mockReset(); });

describe('recordTickExecution', () => {
  it('累加 total_executions 并 UPSERT tick_execution_stats + tick_last', async () => {
    const client = makeClient({ total_executions: 7 });
    const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [] }) };
    await recordTickExecution(1234, { pool });
    const upsert = client.query.mock.calls.find((c) => /INSERT INTO working_memory/.test(c[0]) && c[1]?.[0] === 'tick_execution_stats');
    expect(upsert).toBeTruthy();
    expect(upsert[1][1]).toMatchObject({ total_executions: 8, last_duration_ms: 1234 });
    expect(typeof upsert[1][1].last_executed_at).toBe('string');
    const tickLast = pool.query.mock.calls.find((c) => /INSERT INTO working_memory/.test(c[0]) && c[1]?.[0] === 'tick_last');
    expect(tickLast).toBeTruthy();
    expect(typeof tickLast[1][1].timestamp).toBe('string');
  });

  it('无既有行时从 0 起计', async () => {
    const client = makeClient(null);
    const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [] }) };
    await recordTickExecution(50, { pool });
    const upsert = client.query.mock.calls.find((c) => /INSERT INTO working_memory/.test(c[0]) && c[1]?.[0] === 'tick_execution_stats');
    expect(upsert[1][1].total_executions).toBe(1);
  });

  it('DB 抛错时吞掉不抛出（绝不拖垮 tick 主循环）', async () => {
    const pool = { connect: vi.fn().mockRejectedValue(new Error('db down')), query: vi.fn() };
    await expect(recordTickExecution(10, { pool })).resolves.toBeUndefined();
  });
});

describe('incrementActionsToday', () => {
  it('同日累加', async () => {
    const today = new Date().toISOString().split('T')[0];
    const pool = { query: vi.fn() };
    pool.query.mockImplementation(async (sql) => {
      if (/SELECT/.test(sql)) return { rows: [{ value_json: { date: today, count: 3 } }] };
      return { rows: [] };
    });
    const n = await incrementActionsToday(1, { pool });
    expect(n).toBe(4);
    const upsert = pool.query.mock.calls.find((c) => /INSERT INTO working_memory/.test(c[0]));
    expect(upsert[1][1]).toEqual({ date: today, count: 4 });
  });

  it('跨日重置', async () => {
    const pool = { query: vi.fn() };
    pool.query.mockImplementation(async (sql) => {
      if (/SELECT/.test(sql)) return { rows: [{ value_json: { date: '2026-05-05', count: 692 } }] };
      return { rows: [] };
    });
    const n = await incrementActionsToday(1, { pool });
    expect(n).toBe(1);
  });

  it('DB 抛错时吞掉返回 null', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    await expect(incrementActionsToday(1, { pool })).resolves.toBeNull();
  });
});
