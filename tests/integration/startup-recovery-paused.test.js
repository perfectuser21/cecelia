/**
 * Integration test: cleanupStaleClaims — paused 任务 stale claimed_by 释放
 *
 * DoD 覆盖：
 *   [BEHAVIOR] paused+claimed_by+stale → 启动时被释放
 *   [BEHAVIOR] paused+claimed_at 在 10min 内 → 不被清理
 *   [ARTIFACT] 日志 [startup-recovery] released N paused tasks with stale claimed_by
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({ execSync: vi.fn().mockReturnValue('') }));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  rmSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { cleanupStaleClaims } from '../../packages/brain/src/startup-recovery.js';

const STALE_UUID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FRESH_UUID = 'aaaaaaaa-0000-0000-0000-000000000002';

function makePool(calls) {
  const queryMock = vi.fn();
  for (const val of calls) {
    queryMock.mockResolvedValueOnce(val);
  }
  return { query: queryMock };
}

describe('cleanupStaleClaims — paused 任务释放', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('paused+claimed_by+stale → 被释放，stats.cleaned 增加，日志含 released N paused', async () => {
    const pool = makePool([
      // Step 1: self-PID queued UPDATE
      { rowCount: 0, rows: [] },
      // Step 2: stale queued SELECT
      { rows: [] },
      // Step 3: paused stale UPDATE → 1 row released
      { rowCount: 1, rows: [{ id: STALE_UUID, claimed_by: 'brain-tick-7' }] },
    ]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stats = await cleanupStaleClaims(pool);
    consoleSpy.mockRestore();

    expect(stats.errors).toEqual([]);
    expect(stats.cleaned).toBe(1);

    // Step 3 SQL targets status='paused'
    const pausedCall = pool.query.mock.calls[2];
    expect(pausedCall[0]).toContain("status = 'paused'");
    expect(pausedCall[0]).toContain('claimed_by IS NOT NULL');
    expect(pausedCall[0]).toContain("INTERVAL '10 minutes'");
  });

  it('paused+claimed_at 在 10min 内 → 不被清理（由 DB 时间条件保证）', async () => {
    // 此测试验证 SQL 包含 10 minutes 阈值，而非 claimed_at IS NULL 路径
    // 防止误清新任务的逻辑体现在 SQL WHERE claimed_at < NOW() - INTERVAL '10 minutes'
    const pool = makePool([
      { rowCount: 0, rows: [] },
      { rows: [] },
      { rowCount: 0, rows: [] }, // 未过期任务不在返回集合中
    ]);

    const stats = await cleanupStaleClaims(pool);

    expect(stats.errors).toEqual([]);
    expect(stats.cleaned).toBe(0);

    // 确认 SQL 中有 10 minutes 约束，而非更短或 NULL 路径
    const pausedSql = pool.query.mock.calls[2][0];
    expect(pausedSql).toContain("INTERVAL '10 minutes'");
    // claimed_at IS NULL 不在 paused 清理条件中（防止误清 NULL 的新暂停任务）
    expect(pausedSql).not.toContain('claimed_at IS NULL');
  });

  it('28 个 paused stale → 全部释放，日志记录 released 28', async () => {
    const rows = Array.from({ length: 28 }, (_, i) => ({
      id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
      claimed_by: 'brain-tick-7',
    }));

    const consoleLogs = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      consoleLogs.push(args.join(' '));
    });

    const pool = makePool([
      { rowCount: 0, rows: [] },
      { rows: [] },
      { rowCount: 28, rows },
    ]);

    const stats = await cleanupStaleClaims(pool);
    consoleSpy.mockRestore();

    expect(stats.cleaned).toBe(28);
    const releaseLog = consoleLogs.find(l => l.includes('[startup-recovery] released') && l.includes('paused tasks with stale claimed_by'));
    expect(releaseLog).toBeTruthy();
    expect(releaseLog).toContain('28');
  });

  it('paused + queued 同时有 stale → 两类都被清理，cleaned 累加', async () => {
    const pool = makePool([
      // Step 1: self-PID queued UPDATE → 0
      { rowCount: 0, rows: [] },
      // Step 2: stale queued SELECT → 2 rows
      {
        rows: [
          { id: STALE_UUID, claimed_by: 'brain-tick-6', claimed_at: null },
          { id: FRESH_UUID, claimed_by: 'brain-tick-6', claimed_at: null },
        ],
      },
      // Step 2b: queued UPDATE → 2 rows
      { rowCount: 2, rows: [] },
      // Step 3: paused stale UPDATE → 3 rows
      {
        rowCount: 3,
        rows: [
          { id: 'cccccccc-0000-0000-0000-000000000001', claimed_by: 'brain-tick-7' },
          { id: 'cccccccc-0000-0000-0000-000000000002', claimed_by: 'brain-tick-7' },
          { id: 'cccccccc-0000-0000-0000-000000000003', claimed_by: 'brain-tick-7' },
        ],
      },
    ]);

    const stats = await cleanupStaleClaims(pool);

    expect(stats.errors).toEqual([]);
    expect(stats.cleaned).toBe(5); // 2 queued + 3 paused
  });

  it('pool.query 抛异常 → errors 数组含错误，不向上抛', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('connection refused')),
    };

    const stats = await cleanupStaleClaims(pool);

    expect(stats.errors).toHaveLength(1);
    expect(stats.errors[0]).toContain('connection refused');
    expect(stats.cleaned).toBe(0);
  });
});
