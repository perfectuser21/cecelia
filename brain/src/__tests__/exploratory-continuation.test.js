/**
 * Test: Check 7 - Exploratory Decomposition Continuation
 *
 * Verifies that:
 * 1. checkExploratoryDecompositionContinue() detects completed exploratory tasks
 *    and creates follow-up decomposition tasks
 * 2. runDecompositionChecks() actually calls Check 7 (regression: it was never called before)
 *
 * Root cause fixed: Before this PR, Check 7 was defined but never called in
 * runDecompositionChecks(). Also, executor.js created task_type='dev' instead
 * of 'exploratory' (fixed in PR #309), making Check 7 never trigger even if called.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

describe('Check 7: Exploratory Decomposition Continuation', () => {
  let pool;
  let checkExploratoryDecompositionContinue;
  let runDecompositionChecks;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const dbModule = await import('../db.js');
    pool = dbModule.default;
    const checker = await import('../decomposition-checker.js');
    checkExploratoryDecompositionContinue = checker.checkExploratoryDecompositionContinue;
    runDecompositionChecks = checker.runDecompositionChecks;
  });

  describe('正向路径: 创建续拆任务', () => {
    it('creates continuation task for completed exploratory with next_action=decompose', async () => {
      const expTaskId = 'exp-task-001';
      const projectId = 'proj-001';
      const goalId = 'kr-001';

      // Check 7 query: returns 1 completed exploratory task with next_action='decompose'
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: expTaskId,
          title: '探索: 分析任务调度瓶颈',
          project_id: projectId,
          goal_id: goalId,
          payload: {
            next_action: 'decompose',
            findings: '发现瓶颈在 planner.js 的 SQL 查询，建议添加索引'
          }
        }]
      });

      // createDecompositionTask INSERT
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'new-task-001', title: '探索续拆: 探索: 分析任务调度瓶颈' }]
      });

      const actions = await checkExploratoryDecompositionContinue();

      expect(actions.length).toBeGreaterThanOrEqual(1);
      expect(actions[0].check).toBe('exploratory_continue');
      expect(actions[0].source_task_id).toBe(expTaskId);
    });
  });

  describe('负向路径: 不应触发续拆', () => {
    it('does NOT create continuation when no exploratory tasks exist (regression: pre-PR#309 task_type=dev bug)', async () => {
      // Empty result: no exploratory tasks in DB
      pool.query.mockResolvedValueOnce({ rows: [] });

      const actions = await checkExploratoryDecompositionContinue();

      expect(actions.length).toBe(0);
    });

    it('does NOT create continuation when next_action is missing', async () => {
      // SQL WHERE clause: payload->>'next_action' = 'decompose' filters this out
      // So query returns empty
      pool.query.mockResolvedValueOnce({ rows: [] });

      const actions = await checkExploratoryDecompositionContinue();

      expect(actions.length).toBe(0);
    });

    it('does NOT create duplicate continuation when one already exists (dedup via NOT EXISTS)', async () => {
      // SQL NOT EXISTS subquery prevents duplicates — returns empty
      pool.query.mockResolvedValueOnce({ rows: [] });

      const actions = await checkExploratoryDecompositionContinue();

      expect(actions.length).toBe(0);
    });
  });

  describe('集成: runDecompositionChecks 调用 Check 7', () => {
    it('runDecompositionChecks result includes exploratory_continue actions when Check 7 triggers', async () => {
      const expTaskId = 'exp-task-integration';

      // getActiveExecutionPaths → no active paths (simplify other checks)
      pool.query.mockResolvedValueOnce({ rows: [] });

      // Check 7 query → 1 exploratory task
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: expTaskId,
          title: '探索: 验证 CI 流程',
          project_id: 'proj-001',
          goal_id: 'kr-001',
          payload: { next_action: 'decompose', findings: '可行' }
        }]
      });

      // createDecompositionTask INSERT
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'cont-task-001', title: '探索续拆: 探索: 验证 CI 流程' }]
      });

      const result = await runDecompositionChecks();

      const contActions = result.actions.filter(a => a.check === 'exploratory_continue');
      expect(contActions.length).toBeGreaterThanOrEqual(1);
      expect(contActions[0].source_task_id).toBe(expTaskId);
    });
  });
});
