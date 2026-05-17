/**
 * cleanupStaleClaims UUID 类型修正测试
 * 验证 UPDATE 用 uuid[]，不是 int[]，避免 Brain 启动时 cleanupStaleClaims
 * 抛出 "operator does not exist: uuid = integer"。
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('child_process', () => ({ execSync: vi.fn().mockReturnValue('') }));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  rmSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

let cleanupStaleClaims;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../startup-recovery.js');
  cleanupStaleClaims = mod.cleanupStaleClaims;
});

describe('cleanupStaleClaims uuid[] 类型修正', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('UPDATE 使用 uuid[] 而非 int[]', async () => {
    const queryMock = vi.fn()
      // Call 1: self-PID UPDATE → 0 rows（当前 test 关注的 stale 是 brain-tick-1，非 self）
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // Call 2: SELECT → 1 row stale（非 self-PID）
      .mockResolvedValueOnce({
        rows: [
          { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', claimed_by: 'brain-tick-1', claimed_at: null },
        ],
      })
      // Call 3: UPDATE → 1 row
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const pool = { query: queryMock };
    const stats = await cleanupStaleClaims(pool, { staleMinutes: 60 });

    expect(stats.errors).toEqual([]);
    expect(stats.cleaned).toBe(1);

    // 第三次 query（UPDATE）SQL 应为 uuid[]，不是 int[]
    const updateCall = queryMock.mock.calls[2];
    const sql = updateCall[0];
    expect(sql).toContain('uuid[]');
    expect(sql).not.toContain('int[]');
  });

  it('pool 缺失时返回错误而不抛异常', async () => {
    const stats = await cleanupStaleClaims(null);
    expect(stats.errors).toContain('pool not provided');
    expect(stats.cleaned).toBe(0);
  });

  it('无 stale claim 时不调用 UPDATE', async () => {
    const queryMock = vi.fn()
      // Call 1: self-PID UPDATE → 0 rows
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // Call 2: SELECT → empty
      .mockResolvedValueOnce({ rows: [] });
    const pool = { query: queryMock };
    const stats = await cleanupStaleClaims(pool);
    expect(queryMock).toHaveBeenCalledTimes(2); // self-PID UPDATE + SELECT
    expect(stats.cleaned).toBe(0);
  });
});
