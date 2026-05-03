/**
 * cleanupStaleClaims 单元测试
 *
 * 覆盖：
 * - 2 行 stale task → UPDATE 被调用，cleaned=2
 * - claimed_at 在 staleMinutes 内（非 stale）→ 不清理
 * - 无 claimed_by 的任务 → 不扫（SQL 条件自动过滤，rowCount=0）
 * - 空结果 → cleaned=0，不报错
 * - pool 未传 → errors 含说明，不抛异常
 * - pool.query 抛异常 → 捕获进 errors，不阻塞启动
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

import { cleanupStaleClaims } from '../startup-recovery.js';

describe('cleanupStaleClaims', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('发现 2 行 stale task → UPDATE 被调用且清 2 行', async () => {
    const mockQuery = vi.fn()
      // Call 1: self-PID UPDATE (new) → 0 rows
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // Call 2 (was Call 1): SELECT 返回 2 行 stale
      .mockResolvedValueOnce({
        rows: [
          { id: 'a1b2c3d4-0001-0000-0000-000000000001', claimed_by: 'brain-tick-1', claimed_at: new Date('2020-01-01').toISOString() },
          { id: 'a1b2c3d4-0001-0000-0000-000000000002', claimed_by: 'brain-tick-2', claimed_at: null },
        ],
      })
      // Call 3 (was Call 2): UPDATE 返回 rowCount=2
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'a1b2c3d4-0001-0000-0000-000000000001' }, { id: 'a1b2c3d4-0001-0000-0000-000000000002' }] });

    const result = await cleanupStaleClaims({ query: mockQuery }, { staleMinutes: 60 });

    expect(result.cleaned).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(mockQuery).toHaveBeenCalledTimes(3);

    // 第二次调用是 SELECT 带 staleMinutes 参数
    const [selectSql, selectArgs] = mockQuery.mock.calls[1];
    expect(selectSql).toMatch(/SELECT/i);
    expect(selectSql).toMatch(/claimed_by IS NOT NULL/);
    // 5/3 扩 paused 后改 IN 语法（28 个 paused 任务被 brain-tick-7 锁 19 天的根因）
    expect(selectSql).toMatch(/status IN \('queued', 'paused'\)/);
    expect(selectArgs[1]).toBe(60);

    // 第三次调用是 UPDATE
    const [updateSql, updateArgs] = mockQuery.mock.calls[2];
    expect(updateSql).toMatch(/UPDATE tasks/i);
    expect(updateSql).toMatch(/claimed_by = NULL/);
    expect(updateSql).toMatch(/claimed_at = NULL/);
    expect(updateArgs[0]).toEqual(['a1b2c3d4-0001-0000-0000-000000000001', 'a1b2c3d4-0001-0000-0000-000000000002']);
  });

  it('SELECT 返回空 → cleaned=0 且不触发 UPDATE', async () => {
    const mockQuery = vi.fn()
      // Call 1: self-PID UPDATE (new)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // Call 2 (was Call 1): SELECT 返回空
      .mockResolvedValueOnce({ rows: [] });

    const result = await cleanupStaleClaims({ query: mockQuery });

    expect(result.cleaned).toBe(0);
    expect(result.errors).toHaveLength(0);
    // self-PID UPDATE + SELECT 两次调用，没有 UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toMatch(/SELECT/i);
  });

  it('claimed_at 在 staleMinutes 内 → 不被 SQL 匹配（验证 WHERE 子句）', async () => {
    // 模拟 SQL 侧过滤（DB 不会返回 fresh claim）
    const mockQuery = vi.fn()
      // Call 1: self-PID UPDATE (new)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // Call 2 (was Call 1): SELECT 返回空
      .mockResolvedValueOnce({ rows: [] });

    const result = await cleanupStaleClaims({ query: mockQuery }, { staleMinutes: 60 });

    expect(result.cleaned).toBe(0);
    // 验证 SQL 包含时间窗口过滤
    const selectSql = mockQuery.mock.calls[1][0];
    expect(selectSql).toMatch(/claimed_at IS NULL OR claimed_at </);
    expect(selectSql).toMatch(/INTERVAL '1 minute'/);
  });

  it('SQL WHERE 子句含 claimed_by IS NOT NULL（验证不扫无 claim 的任务）', async () => {
    const mockQuery = vi.fn()
      // Call 1: self-PID UPDATE (new)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // Call 2 (was Call 1): SELECT
      .mockResolvedValueOnce({ rows: [] });

    await cleanupStaleClaims({ query: mockQuery });

    const selectSql = mockQuery.mock.calls[1][0];
    expect(selectSql).toMatch(/claimed_by IS NOT NULL/);
  });

  it('pool 未传入 → errors 含说明，cleaned=0，不抛异常', async () => {
    const result = await cleanupStaleClaims(null);

    expect(result.cleaned).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/pool/i);
  });

  it('pool.query 抛异常 → 错误进 errors，cleaned=0，不向上传播', async () => {
    const mockQuery = vi.fn().mockRejectedValueOnce(new Error('connection lost'));

    const result = await cleanupStaleClaims({ query: mockQuery });

    expect(result.cleaned).toBe(0);
    expect(result.errors).toEqual([expect.stringMatching(/connection lost/)]);
  });

  it('staleMinutes 默认 60 分钟', async () => {
    const mockQuery = vi.fn()
      // Call 1: self-PID UPDATE (new)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // Call 2 (was Call 1): SELECT
      .mockResolvedValueOnce({ rows: [] });

    await cleanupStaleClaims({ query: mockQuery });

    // 未传 opts 时应默认 60，SELECT 的第二个参数是 staleMinutes
    expect(mockQuery.mock.calls[1][1][1]).toBe(60);
  });

  it('自定义 staleMinutes 传递到 SQL 参数', async () => {
    const mockQuery = vi.fn()
      // Call 1: self-PID UPDATE (new)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // Call 2 (was Call 1): SELECT
      .mockResolvedValueOnce({ rows: [] });

    await cleanupStaleClaims({ query: mockQuery }, { staleMinutes: 15 });

    expect(mockQuery.mock.calls[1][1][1]).toBe(15);
  });

  describe('self-PID cleanup（容器重启 PID 复用场景）', () => {
    it('新鲜 claim（< 60 min）且 claimed_by = selfClaimerId → 被无条件清除', async () => {
      const mockQuery = vi.fn()
        // Call 1: self-PID UPDATE → cleaned 1 row
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-1' }] })
        // Call 2: SELECT 60-min scan → empty (no other stale)
        .mockResolvedValueOnce({ rows: [] });

      const result = await cleanupStaleClaims({ query: mockQuery });

      expect(result.cleaned).toBe(1);
      expect(result.errors).toHaveLength(0);

      // 第一次调用必须是 UPDATE，带当前 PID 的 claimerId
      const [selfUpdateSql, selfUpdateArgs] = mockQuery.mock.calls[0];
      expect(selfUpdateSql).toMatch(/UPDATE tasks/i);
      expect(selfUpdateSql).toMatch(/claimed_by = NULL/);
      expect(selfUpdateSql).toMatch(/status IN \('queued', 'paused'\)/);
      expect(selfUpdateSql).toMatch(/claimed_by = \$1/);
      // claimerId 格式：brain-tick-<pid>
      expect(selfUpdateArgs[0]).toMatch(/^brain-tick-\d+$/);
    });

    it('不同 claimerId 的新鲜 claim → 不被 self-PID UPDATE 清除', async () => {
      const mockQuery = vi.fn()
        // Call 1: self-PID UPDATE → 0 rows（无自身 PID 的旧 claim）
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        // Call 2: SELECT 60-min scan → empty（fresh claim 不在 60 min 窗口外）
        .mockResolvedValueOnce({ rows: [] });

      const result = await cleanupStaleClaims({ query: mockQuery });

      expect(result.cleaned).toBe(0);
      // self-PID UPDATE 的 $1 参数不含 other-claimerId
      const selfUpdateArgs = mockQuery.mock.calls[0][1];
      expect(selfUpdateArgs[0]).not.toBe('brain-tick-other');
    });

    it('self-PID cleanup 与 60-min 扫描累加 cleaned 计数', async () => {
      const mockQuery = vi.fn()
        // Call 1: self-PID UPDATE → 2 rows
        .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'a' }, { id: 'b' }] })
        // Call 2: SELECT 60-min → 1 row (other stale)
        .mockResolvedValueOnce({
          rows: [{ id: 'c', claimed_by: 'brain-tick-old', claimed_at: new Date('2020-01-01') }],
        })
        // Call 3: UPDATE → 1 row
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'c' }] });

      const result = await cleanupStaleClaims({ query: mockQuery });

      expect(result.cleaned).toBe(3); // 2 self-PID + 1 stale
      expect(result.errors).toHaveLength(0);
    });
  });
});
