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
      // SELECT 返回 2 行 stale
      .mockResolvedValueOnce({
        rows: [
          { id: 101, claimed_by: 'brain-tick-1', claimed_at: new Date('2020-01-01').toISOString() },
          { id: 102, claimed_by: 'brain-tick-2', claimed_at: null },
        ],
      })
      // UPDATE 返回 rowCount=2
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 101 }, { id: 102 }] });

    const result = await cleanupStaleClaims({ query: mockQuery }, { staleMinutes: 60 });

    expect(result.cleaned).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // 第一次调用是 SELECT 带 staleMinutes 参数
    const [selectSql, selectArgs] = mockQuery.mock.calls[0];
    expect(selectSql).toMatch(/SELECT/i);
    expect(selectSql).toMatch(/claimed_by IS NOT NULL/);
    expect(selectSql).toMatch(/status = 'queued'/);
    expect(selectArgs).toEqual([60]);

    // 第二次调用是 UPDATE
    const [updateSql, updateArgs] = mockQuery.mock.calls[1];
    expect(updateSql).toMatch(/UPDATE tasks/i);
    expect(updateSql).toMatch(/claimed_by = NULL/);
    expect(updateSql).toMatch(/claimed_at = NULL/);
    expect(updateArgs[0]).toEqual([101, 102]);
  });

  it('SELECT 返回空 → cleaned=0 且不触发 UPDATE', async () => {
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });

    const result = await cleanupStaleClaims({ query: mockQuery });

    expect(result.cleaned).toBe(0);
    expect(result.errors).toHaveLength(0);
    // 只有 SELECT 一次调用，没有 UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/SELECT/i);
  });

  it('claimed_at 在 staleMinutes 内 → 不被 SQL 匹配（验证 WHERE 子句）', async () => {
    // 模拟 SQL 侧过滤（DB 不会返回 fresh claim）
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });

    const result = await cleanupStaleClaims({ query: mockQuery }, { staleMinutes: 60 });

    expect(result.cleaned).toBe(0);
    // 验证 SQL 包含时间窗口过滤
    const selectSql = mockQuery.mock.calls[0][0];
    expect(selectSql).toMatch(/claimed_at IS NULL OR claimed_at </);
    expect(selectSql).toMatch(/INTERVAL '1 minute'/);
  });

  it('SQL WHERE 子句含 claimed_by IS NOT NULL（验证不扫无 claim 的任务）', async () => {
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });

    await cleanupStaleClaims({ query: mockQuery });

    const selectSql = mockQuery.mock.calls[0][0];
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
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });

    await cleanupStaleClaims({ query: mockQuery });

    // 未传 opts 时应默认 60
    expect(mockQuery.mock.calls[0][1]).toEqual([60]);
  });

  it('自定义 staleMinutes 传递到 SQL 参数', async () => {
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });

    await cleanupStaleClaims({ query: mockQuery }, { staleMinutes: 15 });

    expect(mockQuery.mock.calls[0][1]).toEqual([15]);
  });
});
