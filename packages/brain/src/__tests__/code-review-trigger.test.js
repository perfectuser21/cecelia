/**
 * code-review-trigger 单元测试
 *
 * 测试 checkAndCreateCodeReviewTrigger：
 * 当 project 下 dev 任务完成数 >= 阈值且无 pending code_review 时，自动创建任务。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkAndCreateCodeReviewTrigger } from '../code-review-trigger.js';

// ─── Mock Pool 工厂 ───────────────────────────────────────

/**
 * @param {object} opts
 * @param {number} opts.devCount - 窗口内完成的 dev 任务数
 * @param {boolean} opts.hasPendingReview - 是否已有 pending code_review
 * @param {object|null} opts.insertedRow - 建单边界返回的任务行
 * @param {string} opts.projectType - project 类型（'project' 或 'initiative'）
 */
function makeMockPool({ devCount = 0, hasPendingReview = false, insertedRow = null, projectType = 'project' } = {}) {
  const calls = [];
  return {
    calls,
    createTask: vi.fn(async (input) => ({ task: insertedRow ?? {
      id: 'new-review-task-id', title: input.title, task_type: input.task_type,
      priority: input.priority, status: 'queued', trigger_source: input.trigger_source,
    } })),
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });

      // Fix 1: project type 查询（新 OKR 表：okr_initiatives/okr_projects）
      if (sql.includes('okr_initiatives') || sql.includes('okr_projects')) {
        if (projectType === 'initiative') {
          return { rows: [{ type: 'initiative' }] };
        }
        return { rows: [{ type: 'project' }] };
      }

      // COUNT 查询
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ cnt: String(devCount) }] };
      }

      // 检查 pending code_review
      if (sql.includes("task_type = 'code_review'")) {
        return { rows: hasPendingReview ? [{ id: 'existing-review-id' }] : [] };
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

  afterEach(() => vi.restoreAllMocks());

  // ─── 正常触发路径 ───

  describe('触发条件满足', () => {
    it('5+ dev 任务完成 + 无 pending code_review → 创建 code_review 任务', async () => {
      const pool = makeMockPool({ devCount: 5, hasPendingReview: false });
      const projectId = 'proj-001';

      const result = await checkAndCreateCodeReviewTrigger(pool, projectId, pool.createTask);

      // 必须返回新创建的任务行
      expect(result).not.toBeNull();
      expect(result.task_type).toBe('code_review');
      expect(result.trigger_source).toBe('accumulation_trigger');

      // 验证 COUNT 查询用了正确 project_id
      const countCall = pool.calls.find(c => c.sql.includes('COUNT(*)'));
      expect(countCall).toBeDefined();
      expect(countCall.params).toContain(projectId);

      // 验证 INSERT 执行了
      expect(pool.createTask).toHaveBeenCalledOnce();
      expect(pool.createTask).toHaveBeenCalledWith(expect.objectContaining({ db: pool, source: 'discovery', source_id: `code-review:${projectId}:5`, project_id: projectId, task_type: 'code_review', priority: 'P2', allow_unscoped: true }));

      // 验证打了日志
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[code-review-trigger]')
      );
    });

    it('超过阈值（8 个）也应触发', async () => {
      const pool = makeMockPool({ devCount: 8, hasPendingReview: false });

      const result = await checkAndCreateCodeReviewTrigger(pool, 'proj-002', pool.createTask);

      expect(result).not.toBeNull();
      expect(pool.createTask).toHaveBeenCalledOnce();
    });
  });

  // ─── 不触发路径 ───

  describe('不满足触发条件', () => {
    it('initiative 类型 project → 不触发积累（有自己的 pipeline）', async () => {
      const pool = makeMockPool({ devCount: 10, hasPendingReview: false, projectType: 'initiative' });

      const result = await checkAndCreateCodeReviewTrigger(pool, 'init-001', pool.createTask);

      expect(result).toBeNull();

      // 验证查了 project type（新 OKR 表）
      const typeCall = pool.calls.find(c => c.sql.includes('okr_initiatives') || c.sql.includes('okr_projects'));
      expect(typeCall).toBeDefined();
      expect(typeCall.params).toContain('init-001');

      // 验证没有 COUNT 查询（提前 return）
      const countCall = pool.calls.find(c => c.sql.includes('COUNT(*)'));
      expect(countCall).toBeUndefined();

      // 验证没有 INSERT
      const insertCall = pool.calls.find(c => c.sql.includes('INSERT INTO tasks'));
      expect(insertCall).toBeUndefined();
    });

    it('project 类型 project → 正常走积累触发', async () => {
      const pool = makeMockPool({ devCount: 5, hasPendingReview: false, projectType: 'project' });

      const result = await checkAndCreateCodeReviewTrigger(pool, 'proj-normal', pool.createTask);

      expect(result).not.toBeNull();
      expect(result.task_type).toBe('code_review');
    });

    it('< 5 dev 任务完成 → 不创建（返回 null）', async () => {
      const pool = makeMockPool({ devCount: 3 });

      const result = await checkAndCreateCodeReviewTrigger(pool, 'proj-003', pool.createTask);

      expect(result).toBeNull();
      expect(pool.createTask).not.toHaveBeenCalled();

      // 验证未执行 INSERT
      const insertCall = pool.calls.find(c => c.sql.includes('INSERT INTO tasks'));
      expect(insertCall).toBeUndefined();
    });

    it('已有 pending code_review → 不重复创建（返回 null）', async () => {
      const pool = makeMockPool({ devCount: 6, hasPendingReview: true });

      const result = await checkAndCreateCodeReviewTrigger(pool, 'proj-004', pool.createTask);

      expect(result).toBeNull();
      expect(pool.createTask).not.toHaveBeenCalled();

      // 验证未执行 INSERT
      const insertCall = pool.calls.find(c => c.sql.includes('INSERT INTO tasks'));
      expect(insertCall).toBeUndefined();
    });

    it('project_id 为 null → 直接返回 null，不查 DB', async () => {
      const pool = makeMockPool({ devCount: 10 });

      const result = await checkAndCreateCodeReviewTrigger(pool, null, pool.createTask);

      expect(result).toBeNull();

      // 验证未查 DB
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  it('建单准入拒绝时返回 null 并记录错误', async () => {
    const pool = makeMockPool({ devCount: 5 });
    pool.createTask.mockRejectedValue(new Error('admission denied'));
    expect(await checkAndCreateCodeReviewTrigger(pool, 'proj-denied', pool.createTask)).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith('[code-review-trigger] 触发失败:', 'admission denied');
  });

  // ─── 错误处理 ───

  describe('错误处理', () => {
    it('DB 查询抛出错误 → catch，返回 null，打 error log', async () => {
      const pool = {
        query: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      };

      const result = await checkAndCreateCodeReviewTrigger(pool, 'proj-005', pool.createTask);

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[code-review-trigger]'),
        expect.stringContaining('DB connection failed')
      );
    });
  });
});
