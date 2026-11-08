import { describe, it, expect } from 'vitest';
import { mockQuery, updateGoal } from './fixture.js';

export function registerUpdateGoal() {
describe('updateGoal', () => {
    it('正常更新 status', async () => {
      const fakeGoal = { id: 'goal-upd', status: 'in_progress' };
      // 新实现先查 objectives，返回 fakeGoal 即成功
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      const result = await updateGoal({
        goal_id: 'goal-upd',
        status: 'in_progress',
      });

      expect(result.success).toBe(true);
      expect(result.goal).toEqual(fakeGoal);
    });

    it('正常更新 progress', async () => {
      const fakeGoal = { id: 'goal-prog', progress: 50 };
      // 第一个查询（objectives）返回空，第二个（key_results）返回结果
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ metadata: {}, custom_props: {} }] })
        .mockResolvedValueOnce({ rows: [fakeGoal] });

      const result = await updateGoal({
        goal_id: 'goal-prog',
        progress: 50,
      });

      expect(result.success).toBe(true);
    });

    it('progress=0 应该被接受（不被当做 falsy 跳过）', async () => {
      const fakeGoal = { id: 'goal-zero', progress: 0 };
      // objectives 返回空，key_results 返回结果（包含 progress=0 参数）
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // objectives
        .mockResolvedValueOnce({ rows: [{ metadata: {}, custom_props: {} }] }) // 系统KR身份
        .mockResolvedValueOnce({ rows: [fakeGoal] });       // key_results

      const result = await updateGoal({
        goal_id: 'goal-zero',
        progress: 0,
      });

      expect(result.success).toBe(true);
      // 实际key_results UPDATE仍必须携带0（身份读取不修改值）。
      const krParams = mockQuery.mock.calls[2][1];
      expect(krParams).toContain(0);
    });

    it('无更新参数返回失败', async () => {
      const result = await updateGoal({ goal_id: 'goal-empty' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No updates');
    });

    it('目标不存在返回失败', async () => {
      // 新实现依次查 objectives → key_results → visions（旧 goals 表 fallback 已移除）
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // objectives
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // key_results
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // visions

      const result = await updateGoal({
        goal_id: 'goal-404',
        status: 'completed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Goal not found');
    });

    it('同时更新 status 和 progress', async () => {
      const fakeGoal = { id: 'goal-both', status: 'completed', progress: 100 };
      // objectives 先被查（返回结果）
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      const result = await updateGoal({
        goal_id: 'goal-both',
        status: 'completed',
        progress: 100,
      });

      expect(result.success).toBe(true);
      // SQL 应包含 updated_at = NOW()
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('updated_at = NOW()');
    });
  });
}
