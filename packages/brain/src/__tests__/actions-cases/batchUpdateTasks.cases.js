import { describe, it, expect } from 'vitest';
import { batchUpdateTasks, mockTaskMutation, taskMutationSql } from './fixture.js';

export function registerBatchUpdateTasks() {
describe('batchUpdateTasks', () => {
    it('按 status 过滤并更新 status', async () => {
      mockTaskMutation([{ id: 'a' }, { id: 'b' }], 2);

      const result = await batchUpdateTasks({
        filter: { status: 'queued' },
        update: { status: 'paused' },
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
    });

    it('按 priority 过滤并更新 priority', async () => {
      mockTaskMutation([{ id: 'c' }], 1);

      const result = await batchUpdateTasks({
        filter: { priority: 'P2' },
        update: { priority: 'P1' },
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
    });

    it('按 project_id 过滤', async () => {
      mockTaskMutation([], 0);

      const result = await batchUpdateTasks({
        filter: { project_id: 'proj-1' },
        update: { status: 'cancelled' },
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
    });

    it('多条件过滤', async () => {
      mockTaskMutation([{ id: 'd' }], 1);

      const result = await batchUpdateTasks({
        filter: { status: 'queued', priority: 'P0', project_id: 'proj-2' },
        update: { status: 'in_progress', priority: 'P1' },
      });

      expect(result.success).toBe(true);
      const sql = taskMutationSql();
      expect(sql).toContain('status =');
      expect(sql).toContain('priority =');
      expect(sql).toContain('project_id =');
    });

    it('无 update 参数返回失败', async () => {
      const result = await batchUpdateTasks({
        filter: { status: 'queued' },
        update: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No updates');
    });

    it('空过滤条件（更新所有任务）', async () => {
      mockTaskMutation([{ id: 'e' }], 5);

      const result = await batchUpdateTasks({
        filter: {},
        update: { status: 'paused' },
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(5);
      const sql = taskMutationSql();
      // 没有额外过滤条件，只有 1=1
      expect(sql).toContain('1=1');
    });
  });
}
