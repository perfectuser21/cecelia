/**
 * code-review-trigger 单元测试
 *
 * 测试 checkAndCreateCodeReviewTrigger：
 * 当 project 下 dev 任务完成数 >= 阈值且无 pending code_review 时，自动创建任务。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkAndCreateCodeReviewTrigger } from '../code-review-trigger.js';

// ─── Mock Pool 工厂 ───────────────────────────────────────

/**
 * @param {object} opts
 * @param {number} opts.devCount - 窗口内完成的 dev 任务数
 * @param {boolean} opts.hasPendingReview - 是否已有 pending code_review
 * @param {object|null} opts.insertedRow - INSERT 返回的行（null 模拟 INSERT 不执行）
 */
function makeMockPool({ devCount = 0, hasPendingReview = false, insertedRow = null } = {}) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });

      // COUNT 查询
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ cnt: String(devCount) }] };
      }

      // 检查 pending code_review
      if (sql.includes("task_type = 'code_review'")) {
        return { rows: hasPendingReview ? [{ id: 'existing-review-id' }] : [] };
      }

      // INSERT
      if (sql.includes('INSERT INTO tasks')) {
        const row = insertedRow ?? {
          id: 'new-review-task-id',
          title: `代码审查：${devCount} 个 dev 任务已完成`,
          task_type: 'code_review',
          priority: 'P2',
          status: 'queued',
          trigger_source: 'accumulation_trigger',
        };
        return { rows: [row] };
      }

      return { rows: [] };
    }),
  };
}

// ─── 测试套件 ────────────────────────────────────────────

describe('code-review-trigger', () => {
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // ─── 正常触发路径 ───

  describe('触发条件满足', () => {
    it('5+ dev 任务完成 + 无 pending code_review → 创建 code_review 任务', async () => {
      const pool = makeMockPool({ devCount: 5, hasPendingReview: false });
      const projectId = 'proj-001';

      const result = await checkAndCreateCodeReviewTrigger(pool, projectId);

      // 必须返回新创建的任务行
      expect(result).not.toBeNull();
      expect(result.task_type).toBe('code_review');
      expect(result.trigger_source).toBe('accumulation_trigger');

      // 验证 COUNT 查询用了正确 project_id
      const countCall = pool.calls.find(c => c.sql.includes('COUNT(*)'));
      expect(countCall).toBeDefined();
      expect(countCall.params).toContain(projectId);

      // 验证 INSERT 执行了
      const insertCall = pool.calls.find(c => c.sql.includes('INSERT INTO tasks'));
      expect(insertCall).toBeDefined();
      expect(insertCall.params).toContain(projectId);

      // 验证打了日志
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[code-review-trigger]')
      );
    });

    it('超过阈值（8 个）也应触发', async () => {
      const pool = makeMockPool({ devCount: 8, hasPendingReview: false });

      const result = await checkAndCreateCodeReviewTrigger(pool, 'proj-002');

      expect(result).not.toBeNull();
      const insertCall = pool.calls.find(c => c.sql.includes('INSERT INTO tasks'));
      expect(insertCall).toBeDefined();
    });
  });

  // ─── 不触发路径 ───

  describe('不满足触发条件', () => {
    it('< 5 dev 任务完成 → 不创建（返回 null）', async () => {
      const pool = makeMockPool({ devCount: 3 });

      const result = await checkAndCreateCodeReviewTrigger(pool, 'proj-003');

      expect(result).toBeNull();

      // 验证未执行 INSERT
      const insertCall = pool.calls.find(c => c.sql.includes('INSERT INTO tasks'));
      expect(insertCall).toBeUndefined();
    });

    it('已有 pending code_review → 不重复创建（返回 null）', async () => {
      const pool = makeMockPool({ devCount: 6, hasPendingReview: true });

      const result = await checkAndCreateCodeReviewTrigger(pool, 'proj-004');

      expect(result).toBeNull();

      // 验证未执行 INSERT
      const insertCall = pool.calls.find(c => c.sql.includes('INSERT INTO tasks'));
      expect(insertCall).toBeUndefined();
    });

    it('project_id 为 null → 直接返回 null，不查 DB', async () => {
      const pool = makeMockPool({ devCount: 10 });

      const result = await checkAndCreateCodeReviewTrigger(pool, null);

      expect(result).toBeNull();

      // 验证未查 DB
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  // ─── 错误处理 ───

  describe('错误处理', () => {
    it('DB 查询抛出错误 → catch，返回 null，打 error log', async () => {
      const pool = {
        query: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      };

      const result = await checkAndCreateCodeReviewTrigger(pool, 'proj-005');

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[code-review-trigger]'),
        expect.stringContaining('DB connection failed')
      );
    });
  });
});
