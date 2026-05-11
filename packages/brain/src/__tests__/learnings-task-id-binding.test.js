/**
 * Migration 270 回归契约：learnings.task_id 物理绑定
 *
 * 防止洞察→行动断链回归：所有有 task_id 上下文的 INSERT 入口必须把 task_id
 * 写入 learnings.task_id 列（而非仅 metadata JSONB），且 decision-executor 的
 * create_learning action 在缺 task_id 时必须显式拒绝。
 *
 * 对应 Cortex Insight learning_id 292f5859-ac6b-4e34-b046-f212196fde47。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('crypto', () => ({
  default: {
    createHash: vi.fn(() => ({
      update: vi.fn(() => ({
        digest: vi.fn(() => ({
          slice: vi.fn(() => 'mock-hash-task-id'),
        })),
      })),
    })),
  },
}));

describe('learnings.task_id 物理绑定（migration 270）', () => {
  let mockPool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.resetModules();
  });

  describe('auto-learning.processExecutionAutoLearning', () => {
    it('completed task 的 INSERT 必须把 task_id 写到 task_id 列', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ task_type: 'dev', title: 'Fix bug' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'learning-1', title: 'x' }] });

      await processExecutionAutoLearning('task-uuid-123', 'completed', { ok: true });

      const insertCall = mockPool.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO learnings')
      );
      expect(insertCall).toBeDefined();
      // SQL 必须列出 task_id 列
      expect(insertCall[0]).toMatch(/task_id\b/);
      // 参数数组必须包含 task_id 值
      expect(insertCall[1]).toContain('task-uuid-123');
    });

    it('failed task 的 INSERT 必须把 task_id 写到 task_id 列', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ task_type: 'feature', title: 'New' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'learning-2', title: 'y' }] });

      await processExecutionAutoLearning('failed-task-uuid', 'failed', { error: 'x' }, { retry_count: 1 });

      const insertCall = mockPool.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO learnings')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toMatch(/task_id\b/);
      expect(insertCall[1]).toContain('failed-task-uuid');
    });
  });

  describe('learning.upsertLearning', () => {
    it('传入 taskId 时必须把它写到 task_id 列', async () => {
      const { upsertLearning } = await import('../learning.js');

      // 第一次 SELECT：不存在 → 走 INSERT 分支
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'new-learning-id' }] });

      const r = await upsertLearning(
        { title: 'foo', content: 'bar', category: 'test', taskId: 'binding-task-uuid' },
        mockPool
      );

      expect(r.upserted).toBe(true);
      const insertCall = mockPool.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO learnings')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toMatch(/task_id\b/);
      expect(insertCall[1]).toContain('binding-task-uuid');
    });
  });

  describe('decision-executor.create_learning', () => {
    it('缺 task_id 时必须拒绝（防止洞察→行动断链）', async () => {
      const { actionHandlers } = await import('../decision-executor.js');

      const r = await actionHandlers.create_learning(
        { content: 'some learning without task' },
        {}
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/task_id/);
    });

    it('带 task_id 时 INSERT 必须把它写到 task_id 列（修复 source_task_id 死代码 bug）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'l-3' }] });
      const { actionHandlers } = await import('../decision-executor.js');

      const r = await actionHandlers.create_learning(
        { content: 'bound learning', task_id: 'task-abc-123' },
        {}
      );
      expect(r.success).toBe(true);
      const insertCall = mockPool.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO learnings')
      );
      expect(insertCall).toBeDefined();
      // 修复后必须使用 task_id 列，不再用不存在的 source_task_id
      expect(insertCall[0]).toMatch(/\btask_id\b/);
      expect(insertCall[0]).not.toMatch(/\bsource_task_id\b/);
      expect(insertCall[1]).toContain('task-abc-123');
    });

    it('兼容旧参数名 source_task_id（向后兼容）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'l-4' }] });
      const { actionHandlers } = await import('../decision-executor.js');

      const r = await actionHandlers.create_learning(
        { content: 'legacy caller', source_task_id: 'legacy-task-id' },
        {}
      );
      expect(r.success).toBe(true);
      const insertCall = mockPool.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO learnings')
      );
      expect(insertCall[1]).toContain('legacy-task-id');
    });
  });
});
