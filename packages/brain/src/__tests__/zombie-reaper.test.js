/**
 * Tests for zombie-reaper.js
 *
 * 覆盖：
 *   (a) 30+ min idle 的 in_progress task → 标 failed
 *   (b) < 30 min idle 的 in_progress task → 不动
 *   (c) 已是 completed/failed 状态的 task → 不动
 *   (d) ENV ZOMBIE_REAPER_IDLE_MIN 自定义阈值生效
 *   (e) startZombieReaper 返回 interval ID（不为 null）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock db.js — 纯单元测试，不依赖真实 PostgreSQL
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

import pool from '../db.js';
import { reapZombies, startZombieReaper, ZOMBIE_REAPER_INTERVAL_MS } from '../zombie-reaper.js';

// ============================================================
// reapZombies — 核心逻辑
// ============================================================

describe('reapZombies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) 30+ min idle in_progress → 标 failed', async () => {
    const zombieRow = { id: 'task-uuid-1', title: 'stuck task' };
    // 第一个 query 返回 zombie 行（SELECT），后续 query 是 UPDATE
    pool.query
      .mockResolvedValueOnce({ rows: [zombieRow], rowCount: 1 })  // SELECT zombies
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });          // UPDATE

    const result = await reapZombies({ pool, idleMinutes: 30 });

    expect(pool.query).toHaveBeenCalledTimes(2);

    // SELECT 查询中必须包含 in_progress 状态判断和 idle 时间判断
    const selectCall = pool.query.mock.calls[0][0];
    expect(selectCall).toMatch(/status\s*=\s*'in_progress'/);
    expect(selectCall).toMatch(/updated_at/);

    // UPDATE 查询必须包含 failed 状态和 zombie reaped 消息
    const updateCall = pool.query.mock.calls[1][0];
    expect(updateCall).toMatch(/status\s*=\s*'failed'/);
    expect(updateCall).toMatch(/zombie/i);

    expect(result.reaped).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('(b) < 30 min idle in_progress → 不动（SELECT 返回空）', async () => {
    // 没有满足条件的 zombie（SELECT 返回空）
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await reapZombies({ pool, idleMinutes: 30 });

    // SELECT 执行一次，没有 UPDATE
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(result.reaped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('(c) 已是 completed/failed 状态 → SELECT 不会返回它们', async () => {
    // completed/failed 任务不满足 WHERE status=\'in_progress\'，所以 SELECT 返回空
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await reapZombies({ pool, idleMinutes: 30 });

    expect(result.reaped).toBe(0);

    // 确认 SELECT 语句只查 in_progress
    const selectCall = pool.query.mock.calls[0][0];
    expect(selectCall).toMatch(/status\s*=\s*'in_progress'/);
    // completed/failed 不应出现在 WHERE 条件中
    expect(selectCall).not.toMatch(/status\s*=\s*'completed'/);
    expect(selectCall).not.toMatch(/status\s*=\s*'failed'/);
  });

  it('(d) idleMinutes 参数控制 INTERVAL 阈值', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await reapZombies({ pool, idleMinutes: 60 });

    const selectCall = pool.query.mock.calls[0][0];
    // INTERVAL 参数里应有 60（分钟数）
    expect(selectCall).toMatch(/60/);
  });

  it('(e) 多个 zombie task 全部标 failed', async () => {
    const zombies = [
      { id: 'task-uuid-1', title: 'zombie 1' },
      { id: 'task-uuid-2', title: 'zombie 2' },
    ];
    pool.query
      .mockResolvedValueOnce({ rows: zombies, rowCount: 2 })  // SELECT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })       // UPDATE task-1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });      // UPDATE task-2

    const result = await reapZombies({ pool, idleMinutes: 30 });

    expect(result.reaped).toBe(2);
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('(f) UPDATE 失败时记录 error 但继续处理下一个 zombie', async () => {
    const zombies = [
      { id: 'task-uuid-1', title: 'zombie 1' },
      { id: 'task-uuid-2', title: 'zombie 2' },
    ];
    pool.query
      .mockResolvedValueOnce({ rows: zombies, rowCount: 2 })           // SELECT
      .mockRejectedValueOnce(new Error('DB write error'))               // UPDATE task-1 fails
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });               // UPDATE task-2 succeeds

    const result = await reapZombies({ pool, idleMinutes: 30 });

    // task-2 还是被处理了
    expect(result.reaped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/task-uuid-1/);
  });
});

// ============================================================
// startZombieReaper — interval 注册
// ============================================================

describe('startZombieReaper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('返回非 null 的 interval ID', () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const timer = startZombieReaper({ pool });
    expect(timer).not.toBeNull();
    clearInterval(timer);
  });

  it('ZOMBIE_REAPER_INTERVAL_MS 是正数（默认 5 min）', () => {
    expect(ZOMBIE_REAPER_INTERVAL_MS).toBeGreaterThan(0);
    // 默认应该是 5 分钟
    expect(ZOMBIE_REAPER_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it('每隔 ZOMBIE_REAPER_INTERVAL_MS 自动触发 reapZombies', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const timer = startZombieReaper({ pool });

    // 时间快进一个完整间隔
    await vi.advanceTimersByTimeAsync(ZOMBIE_REAPER_INTERVAL_MS);

    // pool.query 至少被调用过一次（SELECT zombies）
    expect(pool.query).toHaveBeenCalled();

    clearInterval(timer);
  });
});
