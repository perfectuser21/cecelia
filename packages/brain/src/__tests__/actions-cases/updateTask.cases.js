import { describe, it, expect } from 'vitest';
import { mockQuery, mockBroadcast, updateTask, mockTaskMutation, taskMutationSql } from './fixture.js';

export function registerUpdateTask() {
describe('updateTask', () => {
    it('正常更新 status', async () => {
      const fakeTask = { id: 'task-upd', status: 'completed' };
      mockTaskMutation([fakeTask]);

      const result = await updateTask({
        task_id: 'task-upd',
        status: 'completed',
      });

      expect(result.success).toBe(true);
      expect(result.task).toEqual(fakeTask);
      expect(mockBroadcast).toHaveBeenCalledWith('task-upd');
    });

    it('正常更新 priority', async () => {
      const fakeTask = { id: 'task-pri', priority: 'P0' };
      mockTaskMutation([fakeTask]);

      const result = await updateTask({
        task_id: 'task-pri',
        priority: 'P0',
      });

      expect(result.success).toBe(true);
    });

    it('同时更新 status 和 priority', async () => {
      const fakeTask = { id: 'task-both', status: 'completed', priority: 'P0' };
      mockTaskMutation([fakeTask]);

      const result = await updateTask({
        task_id: 'task-both',
        status: 'completed',
        priority: 'P0',
      });

      expect(result.success).toBe(true);
    });

    it('无更新参数返回失败', async () => {
      const result = await updateTask({ task_id: 'task-empty' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No updates');
    });

    it('任务不存在返回失败', async () => {
      mockTaskMutation([]);

      const result = await updateTask({
        task_id: 'task-404',
        status: 'completed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Task not found');
    });

    it('in_progress 状态有原子守卫（只有 queued 可以转移）', async () => {
      mockTaskMutation([]);

      const result = await updateTask({
        task_id: 'task-guard',
        status: 'in_progress',
      });

      // 检查 SQL 包含 AND status = 'queued'
      const sql = taskMutationSql();
      expect(sql).toContain("status = 'queued'");
      expect(result.success).toBe(false);
      expect(result.error).toContain('already dispatched');
    });

    it('in_progress 转移成功', async () => {
      const fakeTask = { id: 'task-disp', status: 'in_progress' };
      mockTaskMutation([fakeTask]);

      const result = await updateTask({
        task_id: 'task-disp',
        status: 'in_progress',
      });

      expect(result.success).toBe(true);
    });

    it('completed 状态设置 completed_at', async () => {
      const fakeTask = { id: 'task-comp', status: 'completed' };
      mockTaskMutation([fakeTask]);

      await updateTask({
        task_id: 'task-comp',
        status: 'completed',
      });

      const sql = mockQuery.mock.calls.find(([query]) => /UPDATE tasks/.test(query))[0];
      expect(sql).toContain('completed_at = NOW()');
    });

    it('in_progress 状态设置 started_at', async () => {
      const fakeTask = { id: 'task-start', status: 'in_progress' };
      mockTaskMutation([fakeTask]);

      await updateTask({
        task_id: 'task-start',
        status: 'in_progress',
      });

      const sql = taskMutationSql();
      expect(sql).toContain('started_at = NOW()');
    });

    it('queued 状态同时清除 claimed_by 和 claimed_at', async () => {
      const fakeTask = { id: 'task-requeue', status: 'queued', claimed_by: null, claimed_at: null };
      mockTaskMutation([fakeTask]);

      const result = await updateTask({
        task_id: 'task-requeue',
        status: 'queued',
      });

      expect(result.success).toBe(true);
      const sql = taskMutationSql();
      expect(sql).toContain('claimed_by = NULL');
      expect(sql).toContain('claimed_at = NULL');
    });

    it('转 queued 时 WHERE 带终态守卫（completed/cancelled 不可被打回）', async () => {
      const fakeTask = { id: 'task-requeue2', status: 'queued' };
      mockTaskMutation([fakeTask]);

      await updateTask({ task_id: 'task-requeue2', status: 'queued' });

      const sql = taskMutationSql();
      expect(sql).toContain(`status NOT IN ('completed', 'cancelled')`);
    });

    it('completed 任务转 queued 被拒（0 行命中返回 error）', async () => {
      mockTaskMutation([]);

      const result = await updateTask({ task_id: 'task-done', status: 'queued' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/terminal state/);
    });

    it('转 in_progress / completed 不受终态守卫影响', async () => {
      const fakeTask = { id: 'task-c', status: 'completed' };
      mockTaskMutation([fakeTask]);

      await updateTask({ task_id: 'task-c', status: 'completed' });

      const sql = mockQuery.mock.calls.find(([query]) => /UPDATE tasks/.test(query))[0];
      expect(sql).not.toContain(`status NOT IN`);
    });
  });
}
