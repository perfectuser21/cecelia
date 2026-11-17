import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
import { getAutoFixStats } from '../auto-fix.js';
beforeEach(() => vi.clearAllMocks());
describe('历史自动修复记录统计', () => {
  describe('getAutoFixStats', () => {
    it('正常返回统计数据', async () => {
      const fakeStats = {
        total_auto_fixes: '5',
        completed_fixes: '3',
        failed_fixes: '1',
        in_progress_fixes: '0',
        queued_fixes: '1'
      };
      mockQuery.mockResolvedValueOnce({ rows: [fakeStats] });

      const result = await getAutoFixStats();

      expect(result).toEqual(fakeStats);
    });

    it('SQL 查询 tasks 表并过滤 auto-fix 标签', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await getAutoFixStats();

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tasks');
      expect(sql).toContain('auto-fix');
    });

    it('SQL 使用 ANY(tags) 数组包含操作', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await getAutoFixStats();

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toMatch(/ANY\(tags\)|= ANY/);
    });

    it('SQL 包含 COUNT(*) 聚合', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await getAutoFixStats();

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('COUNT(*)');
    });

    it('SQL 包含按 status 分组的 FILTER 条件', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await getAutoFixStats();

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('completed');
      expect(sql).toContain('failed');
      expect(sql).toContain('in_progress');
      expect(sql).toContain('queued');
    });

    it('所有 fix 数量为 0 时正常返回', async () => {
      const emptyStats = {
        total_auto_fixes: '0',
        completed_fixes: '0',
        failed_fixes: '0',
        in_progress_fixes: '0',
        queued_fixes: '0'
      };
      mockQuery.mockResolvedValueOnce({ rows: [emptyStats] });

      const result = await getAutoFixStats();

      expect(result.total_auto_fixes).toBe('0');
    });

    it('pool.query 被调用一次', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await getAutoFixStats();

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('pool.query 失败时抛出异常', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection timeout'));

      await expect(getAutoFixStats()).rejects.toThrow('Connection timeout');
    });
  });
});
