/**
 * Tests for zombie-reaper.js
 *
 * 覆盖：
 *   (a) brain-local probe=dead → 标 failed（assessTaskLiveness 返回 dead + onStale=fail）
 *   (b) < 30 min idle in_progress → 不动（SELECT 返回空）
 *   (c) 已是 completed/failed 状态 → SELECT 不返回（WHERE status='in_progress'）
 *   (d) ENV ZOMBIE_REAPER_IDLE_MIN 自定义阈值生效
 *   (e) startZombieReaper 返回 interval ID（不为 null）
 *   (f) UPDATE 失败时记录 error 但继续处理下一个
 *   (g) alive → 跳过不杀（T2 核心：exemptTypes 改为 assessTaskLiveness）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock db.js — 纯单元测试，不依赖真实 PostgreSQL
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

// Mock executor-contracts.js — 默认返回 dead+fail，测试内可覆盖
vi.mock('../executor-contracts.js', () => ({
  assessTaskLiveness: vi.fn().mockResolvedValue({ verdict: 'dead', onStale: 'fail', kind: 'brain-local' }),
}));

import pool from '../db.js';
import { assessTaskLiveness } from '../executor-contracts.js';
import { reapZombies, startZombieReaper, ZOMBIE_REAPER_INTERVAL_MS } from '../zombie-reaper.js';

// ============================================================
// reapZombies — 核心逻辑
// ============================================================

describe('reapZombies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：assessTaskLiveness 返回 dead+fail（brain-local 场景）
    assessTaskLiveness.mockResolvedValue({ verdict: 'dead', onStale: 'fail', kind: 'brain-local' });
  });

  it('(a) brain-local probe=dead → 标 failed', async () => {
    const zombieRow = { id: 'task-uuid-1', title: 'stuck task', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null };
    pool.query
      .mockResolvedValueOnce({ rows: [zombieRow], rowCount: 1 })          // SELECT zombies
      .mockResolvedValueOnce({ rows: [{ last_hb: 0 }], rowCount: 1 })     // T7 心跳查询（无心跳）
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                  // UPDATE

    const result = await reapZombies({ pool, idleMinutes: 30 });

    expect(pool.query).toHaveBeenCalledTimes(3);

    const selectCall = pool.query.mock.calls[0][0];
    expect(selectCall).toMatch(/status\s*=\s*'in_progress'/);
    expect(selectCall).toMatch(/updated_at/);

    const updateCall = pool.query.mock.calls[2][0];
    expect(updateCall).toMatch(/status\s*=\s*'failed'/);
    const updateParams = pool.query.mock.calls[2][1];
    expect(updateParams[0]).toMatch(/zombie/i);

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

  it('(e) 多个 brain-local dead zombie 全部标 failed', async () => {
    const zombies = [
      { id: 'task-uuid-1', title: 'zombie 1', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null },
      { id: 'task-uuid-2', title: 'zombie 2', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null },
    ];
    pool.query
      .mockResolvedValueOnce({ rows: zombies, rowCount: 2 })              // SELECT
      .mockResolvedValueOnce({ rows: [{ last_hb: 0 }], rowCount: 1 })     // 心跳 task-1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                   // UPDATE task-1
      .mockResolvedValueOnce({ rows: [{ last_hb: 0 }], rowCount: 1 })     // 心跳 task-2
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                  // UPDATE task-2

    const result = await reapZombies({ pool, idleMinutes: 30 });

    expect(result.reaped).toBe(2);
    expect(pool.query).toHaveBeenCalledTimes(5);
  });

  it('(g) T2: alive verdict → 跳过不杀（替代旧 exemptTypes SQL 过滤）', async () => {
    assessTaskLiveness.mockResolvedValue({ verdict: 'alive', onStale: 'release-claim-and-alert' });

    const task = { id: 'task-alive-1', title: 'alive task', executor_kind: 'headed-session', updated_at: new Date(Date.now() - 70 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: 'session:alive' };
    pool.query.mockResolvedValueOnce({ rows: [task], rowCount: 1 });

    const result = await reapZombies({ pool, idleMinutes: 60 });

    // 只有 SELECT，没有 UPDATE
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(result.reaped).toBe(0);
  });

  it('(f) UPDATE 失败时记录 error 但继续处理下一个 zombie', async () => {
    const zombies = [
      { id: 'task-uuid-1', title: 'zombie 1', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null },
      { id: 'task-uuid-2', title: 'zombie 2', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null },
    ];
    pool.query
      .mockResolvedValueOnce({ rows: zombies, rowCount: 2 })              // SELECT
      .mockResolvedValueOnce({ rows: [{ last_hb: 0 }], rowCount: 1 })     // 心跳 task-1
      .mockRejectedValueOnce(new Error('DB write error'))                 // UPDATE task-1 fails
      .mockResolvedValueOnce({ rows: [{ last_hb: 0 }], rowCount: 1 })     // 心跳 task-2
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                  // UPDATE task-2

    const result = await reapZombies({ pool, idleMinutes: 30 });

    // task-2 还是被处理了
    expect(result.reaped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/task-uuid-1/);
  });

  // ============================================================
  // T7: phase-event 心跳第二判活信号
  // ============================================================

  it('(h) T7: updated_at 过期但 phase-event 心跳新鲜 → 不杀', async () => {
    const task = { id: 'task-hb-fresh', title: 'relay task', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null, payload_initiative_id: null };
    const freshHb = Math.floor(Date.now() / 1000) - 60; // 1 分钟前的心跳
    pool.query
      .mockResolvedValueOnce({ rows: [task], rowCount: 1 })               // SELECT zombies
      .mockResolvedValueOnce({ rows: [{ last_hb: freshHb }], rowCount: 1 }); // 心跳新鲜

    const result = await reapZombies({ pool, idleMinutes: 60 });

    expect(pool.query).toHaveBeenCalledTimes(2); // 只有 SELECT + 心跳，没有 UPDATE
    expect(result.reaped).toBe(0);
    expect(result.errors).toHaveLength(0);
    // 心跳查询打在 initiative_run_events 表、用 task.id 作 initiative_id
    const hbCall = pool.query.mock.calls[1];
    expect(hbCall[0]).toMatch(/initiative_run_events/);
    expect(hbCall[1]).toEqual(['task-hb-fresh']);
  });

  it('(i) T7: 心跳过期 → 照常 reap', async () => {
    const task = { id: 'task-hb-stale', title: 'stale hb task', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null, payload_initiative_id: null };
    const staleHb = Math.floor(Date.now() / 1000) - 70 * 60; // 70 分钟前（> idleMinutes=60）
    pool.query
      .mockResolvedValueOnce({ rows: [task], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ last_hb: staleHb }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                  // UPDATE

    const result = await reapZombies({ pool, idleMinutes: 60 });

    expect(result.reaped).toBe(1);
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('(j) T7: 心跳查询抛错 → 视为无心跳照常 reap，不进 result.errors', async () => {
    const task = { id: 'task-hb-err', title: 'hb err task', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null, payload_initiative_id: null };
    pool.query
      .mockResolvedValueOnce({ rows: [task], rowCount: 1 })
      .mockRejectedValueOnce(new Error('relation does not exist'))        // 心跳查询失败
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                  // UPDATE 仍执行

    const result = await reapZombies({ pool, idleMinutes: 60 });

    expect(result.reaped).toBe(1);
    expect(result.errors).toHaveLength(0); // 心跳失败只 warn，不算任务处置错误
  });

  it('(k) T7: payload.initiative_id 存在时心跳查询用它而非 task.id', async () => {
    const task = { id: 'task-hb-payload', title: 'payload initiative task', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null, payload_initiative_id: 'initiative-uuid-x' };
    const freshHb = Math.floor(Date.now() / 1000) - 60;
    pool.query
      .mockResolvedValueOnce({ rows: [task], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ last_hb: freshHb }], rowCount: 1 });

    const result = await reapZombies({ pool, idleMinutes: 60 });

    expect(result.reaped).toBe(0);
    expect(pool.query.mock.calls[1][1]).toEqual(['initiative-uuid-x']);
  });

  it('(l) T7: release-claim-and-alert 分支同样被心跳守卫保护', async () => {
    assessTaskLiveness.mockResolvedValue({ verdict: 'dead', onStale: 'release-claim-and-alert', kind: 'headed-session' });
    const task = { id: 'task-hb-headed', title: 'headed task', executor_kind: 'headed-session', updated_at: new Date(Date.now() - 180 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: 'session:gone', payload_initiative_id: null };
    const freshHb = Math.floor(Date.now() / 1000) - 120;
    pool.query
      .mockResolvedValueOnce({ rows: [task], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ last_hb: freshHb }], rowCount: 1 });

    const result = await reapZombies({ pool, idleMinutes: 60 });

    expect(result.reaped).toBe(0);
    expect(pool.query).toHaveBeenCalledTimes(2);
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
