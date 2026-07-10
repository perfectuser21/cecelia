/**
 * 回归测试：T9 learnings 噪音过滤
 *
 * 1. task_completion 类目不再写入 learnings（execution.js 回调移除该块）
 * 2. createAutoLearning 写 summary 字段
 * 3. upsertLearning 写 summary 字段
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('crypto', () => ({
  default: {
    createHash: vi.fn(() => ({
      update: vi.fn(() => ({
        digest: vi.fn(() => ({ slice: vi.fn(() => 'abc123') }))
      }))
    }))
  }
}));

describe('T9 learnings 噪音过滤（回归）', () => {
  let mockPool;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockPool = { query: vi.fn() };
    vi.doMock('../db.js', () => ({ default: mockPool }));
  });

  describe('auto-learning: createAutoLearning 写 summary', () => {
    it('INSERT 语句应包含 summary 列，且值非空', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ task_type: 'dev', title: 'Fix bug', error_message: null }] })
        .mockResolvedValueOnce({ rows: [] }) // dedup: not found
        .mockResolvedValueOnce({ rows: [{ id: 'lr-1', title: '任务完成：t1' }] });

      await processExecutionAutoLearning('t1', 'completed', 'PR merged, all green');

      const insertCall = mockPool.query.mock.calls[2];
      const sql = insertCall[0];
      const params = insertCall[1];

      expect(sql).toMatch(/INSERT INTO learnings/);
      expect(sql).toContain('summary');
      // summary 是第 5 个参数（index 4），必须是非空字符串
      expect(typeof params[4]).toBe('string');
      expect(params[4].length).toBeGreaterThan(0);
    });
  });

  describe('upsertLearning 写 summary', () => {
    it('INSERT 时应传 summary 参数', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // existing check: not found
        .mockResolvedValueOnce({ rows: [{ id: 'lr-2' }] }); // insert

      const { upsertLearning } = await import('../learning.js');
      await upsertLearning({ title: '测试洞察', content: '内容详情', category: 'conversation_insight' }, mockPool);

      const insertCall = mockPool.query.mock.calls[1];
      const sql = insertCall[0];

      expect(sql).toContain('summary');
    });
  });

  describe('execution.js 回调不再写 task_completion 到 learnings', () => {
    it('routes/execution.js 源码中不含 task_completion INSERT', async () => {
      // 直接读源码进行静态断言：task_completion category 不应出现在 INSERT 语句中
      const fs = await import('fs');
      const src = fs.readFileSync(new URL('../routes/execution.js', import.meta.url).pathname, 'utf8');

      // 确认 task_completion INSERT 已被移除
      expect(src).not.toMatch(/'task_completion'.*task_completed/s);
      expect(src).not.toContain("VALUES ($1, 'task_completion'");
    });
  });
});
