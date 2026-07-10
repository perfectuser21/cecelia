/**
 * Tests for zombie-reaper.js — T2 重写版
 *
 * 覆盖：
 *   (a) brain-local 任务 probe=dead → 标 failed
 *   (b) SELECT 返回空 → 不动
 *   (c) SELECT 只查 in_progress，completed/failed 不会出现
 *   (d) probe=alive / unknown → fail-open，不标 failed
 *   (e) 多个 brain-local zombie → 全部标 failed
 *   (f) UPDATE 失败时记录 error 但继续处理下一个
 *   (g) headed-session verdict=dead → status=queued（不是 failed）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock db.js — 纯单元测试，不依赖真实 PostgreSQL
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock executor-contracts.js — assessTaskLiveness 是守护刀唯一入口
const mockAssessTaskLiveness = vi.fn();
vi.mock('../executor-contracts.js', () => ({
  assessTaskLiveness: (...args) => mockAssessTaskLiveness(...args),
}));

// Mock notifier.js
vi.mock('../notifier.js', () => ({
  sendFeishu: vi.fn().mockResolvedValue(true),
}));

import pool from '../db.js';
import { reapZombies, startZombieReaper, ZOMBIE_REAPER_INTERVAL_MS } from '../zombie-reaper.js';

// ─── 辅助 ────────────────────────────────────────────────────────────────────

function makeTask(overrides = {}) {
  return {
    id: 'task-uuid-1',
    title: 'stuck task',
    task_type: 'dev',
    executor_kind: 'brain-local',
    updated_at: new Date(Date.now() - 70 * 60 * 1000).toISOString(),
    claimed_by: null,
    last_attempt_at: null,
    ...overrides,
  };
}

// ============================================================
// reapZombies — 核心逻辑
// ============================================================

describe('reapZombies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：brain-local dead → fail
    mockAssessTaskLiveness.mockResolvedValue({ verdict: 'dead', onStale: 'fail', kind: 'brain-local' });
  });

  it('(a) brain-local probe=dead → 标 failed', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [makeTask()], rowCount: 1 })  // SELECT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });           // UPDATE failed

    const result = await reapZombies({ pool });

    expect(pool.query).toHaveBeenCalledTimes(2);

    const selectCall = pool.query.mock.calls[0][0];
    expect(selectCall).toMatch(/status\s*=\s*'in_progress'/);
    expect(selectCall).toMatch(/executor_kind/);

    const updateCall = pool.query.mock.calls[1][0];
    expect(updateCall).toMatch(/status\s*=\s*'failed'/);
    const updateParams = pool.query.mock.calls[1][1];
    expect(updateParams[0]).toMatch(/zombie/i);

    expect(result.reaped).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('(b) SELECT 返回空 → 不动', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await reapZombies({ pool });

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(result.reaped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('(c) SELECT 只查 in_progress', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await reapZombies({ pool });

    const selectCall = pool.query.mock.calls[0][0];
    expect(selectCall).toMatch(/status\s*=\s*'in_progress'/);
    expect(selectCall).not.toMatch(/status\s*=\s*'completed'/);
    expect(selectCall).not.toMatch(/status\s*=\s*'failed'/);
  });

  it('(d) probe=alive → fail-open，不 UPDATE', async () => {
    mockAssessTaskLiveness.mockResolvedValue({ verdict: 'alive', kind: 'brain-local' });
    pool.query.mockResolvedValueOnce({ rows: [makeTask()], rowCount: 1 });

    const result = await reapZombies({ pool });

    const updateCalls = pool.query.mock.calls.filter(([sql]) => sql.includes('UPDATE'));
    expect(updateCalls).toHaveLength(0);
    expect(result.reaped).toBe(0);
  });

  it('(d2) probe=unknown → fail-open，不 UPDATE', async () => {
    mockAssessTaskLiveness.mockResolvedValue({ verdict: 'unknown', reason: 'no_executor_kind' });
    pool.query.mockResolvedValueOnce({ rows: [makeTask()], rowCount: 1 });

    const result = await reapZombies({ pool });

    const updateCalls = pool.query.mock.calls.filter(([sql]) => sql.includes('UPDATE'));
    expect(updateCalls).toHaveLength(0);
    expect(result.reaped).toBe(0);
  });

  it('(e) 多个 brain-local zombie → 全部标 failed', async () => {
    const zombies = [makeTask({ id: 'task-uuid-1' }), makeTask({ id: 'task-uuid-2' })];
    pool.query
      .mockResolvedValueOnce({ rows: zombies, rowCount: 2 })  // SELECT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })       // UPDATE task-1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });      // UPDATE task-2

    const result = await reapZombies({ pool });

    expect(result.reaped).toBe(2);
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('(f) UPDATE 失败时记录 error 但继续处理下一个 zombie', async () => {
    const zombies = [makeTask({ id: 'task-uuid-1' }), makeTask({ id: 'task-uuid-2' })];
    pool.query
      .mockResolvedValueOnce({ rows: zombies, rowCount: 2 })           // SELECT
      .mockRejectedValueOnce(new Error('DB write error'))               // UPDATE task-1 fails
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });               // UPDATE task-2 succeeds

    const result = await reapZombies({ pool });

    expect(result.reaped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/task-uuid-1/);
  });

  it('(g) headed-session verdict=dead → status=queued，不是 failed（07-10 事故防回归）', async () => {
    mockAssessTaskLiveness.mockResolvedValue({
      verdict: 'dead',
      onStale: 'release-claim-and-alert',
      kind: 'headed-session',
    });
    const hsTask = makeTask({ id: 'hs-01', executor_kind: 'headed-session', claimed_by: 'session:x' });
    pool.query
      .mockResolvedValueOnce({ rows: [hsTask], rowCount: 1 })  // SELECT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });        // UPDATE release

    const result = await reapZombies({ pool });

    const updateCalls = pool.query.mock.calls.filter(([sql]) => sql.includes('UPDATE'));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][0]).toMatch(/status\s*=\s*'queued'/);
    expect(updateCalls[0][0]).not.toMatch(/status\s*=\s*'failed'/);
    expect(result.reaped).toBe(0);
    expect(result.released).toBe(1);
  });
});

// ============================================================
// startZombieReaper — interval 注册
// ============================================================

describe('startZombieReaper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockAssessTaskLiveness.mockResolvedValue({ verdict: 'alive', kind: 'brain-local' });
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
    expect(ZOMBIE_REAPER_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it('每隔 ZOMBIE_REAPER_INTERVAL_MS 自动触发 reapZombies', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const timer = startZombieReaper({ pool });

    await vi.advanceTimersByTimeAsync(ZOMBIE_REAPER_INTERVAL_MS);

    expect(pool.query).toHaveBeenCalled();

    clearInterval(timer);
  });
});
