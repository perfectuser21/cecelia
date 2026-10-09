/**
 * decomposition-checker.test.js - OKR 统一版 (v2.0)
 *
 * 测试新的 2-check 系统:
 *   Check A: checkPendingKRs — pending KR → 秋米拆解
 *   Check B: checkReadyKRInitiatives — ready KR Initiative 状态 + Task 检测
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

// Mock capacity.js
vi.mock('../capacity.js', () => ({
  computeCapacity: () => ({
    project: { max: 2, softMin: 1 },
    initiative: { max: 9, softMin: 3 },
    task: { queuedCap: 27, softMin: 9 },
  }),
  isAtCapacity: (current, max) => current >= max,
}));

// Mock task-quality-gate.js
vi.mock('../task-quality-gate.js', () => ({
  validateTaskDescription: () => ({ valid: true, reasons: [] }),
}));

const mockCreateTask = vi.hoisted(() => vi.fn());
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));

describe('decomposition-checker v2.0', () => {
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCreateTask.mockResolvedValue({ task: { id: 'task-1', title: 'routed task' } });
    const dbModule = await import('../db.js');
    pool = dbModule.default;
  });

  // ─── Check A: checkPendingKRs ───

  describe('Check A: checkPendingKRs', () => {
    it('initiative_plan 已退役（决策 ee4842a6）→ createDecompositionTask 恒 rejected，skip_rejected', async () => {
      const { checkPendingKRs } = await import('../decomposition-checker.js');

      // Find pending KRs
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr-1', title: 'Test KR', description: 'desc', priority: 'P0', parent_id: 'area-1' }]
      });

      // hasExistingDecompositionTask → no existing
      pool.query.mockResolvedValueOnce({ rows: [] });

      // canCreateDecompositionTask → under WIP limit
      pool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const actions = await checkPendingKRs();

      expect(actions.length).toBe(1);
      expect(actions[0].action).toBe('skip_rejected');
      expect(actions[0].goal_id).toBe('kr-1');
      // 退役后不再写 key_results.status='decomposing'（没有 UPDATE 调用）
      expect(pool.query).toHaveBeenCalledTimes(3);
    });

    it('should skip when decomposition task already exists (dedup)', async () => {
      const { checkPendingKRs } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr-1', title: 'Test KR', description: 'desc', priority: 'P0', parent_id: 'area-1' }]
      });

      // hasExistingDecompositionTask → existing found
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-task' }] });

      const actions = await checkPendingKRs();

      expect(actions.length).toBe(1);
      expect(actions[0].action).toBe('skip_dedup');
    });

    it('should skip when WIP limit reached', async () => {
      const { checkPendingKRs } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr-1', title: 'Test KR', description: 'desc', priority: 'P0', parent_id: 'area-1' }]
      });

      // hasExistingDecompositionTask → no existing
      pool.query.mockResolvedValueOnce({ rows: [] });

      // canCreateDecompositionTask → at WIP limit (3)
      pool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] });

      const actions = await checkPendingKRs();

      expect(actions.length).toBe(1);
      expect(actions[0].action).toBe('skip_wip');
    });

    it('should handle no pending KRs gracefully', async () => {
      const { checkPendingKRs } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({ rows: [] });

      const actions = await checkPendingKRs();

      expect(actions.length).toBe(0);
    });
  });

  // ─── Check B: checkReadyKRInitiatives ───

  describe('Check B: checkReadyKRInitiatives（已退役，决策 ee4842a6，棒4）', () => {
    // 原逻辑经 okr_initiatives → okr_scopes → okr_projects 驱动 KR 状态流转
    // （ready→in_progress / →completed）。scope/initiative 层退役后（migration 499
    // 写保护）这条链不再产生数据，已清空为 no-op：恒返回空数组，不查询任何表——
    // 这是"tick 一轮无 okr_scopes/okr_initiatives 查询"验收标准的关键回归守卫。

    it('恒返回空数组，且从不查询数据库', async () => {
      const { checkReadyKRInitiatives } = await import('../decomposition-checker.js');

      const actions = await checkReadyKRInitiatives();

      expect(actions).toEqual([]);
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  // ─── Check C: checkKRWithoutProject ───

  describe('Check C: checkKRWithoutProject', () => {
    it('initiative_plan 已退役（决策 ee4842a6）→ createDecompositionTask 恒 rejected，skip_rejected', async () => {
      const { checkKRWithoutProject } = await import('../decomposition-checker.js');

      // Find ready/in_progress KRs with no project_kr_links
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr-1', title: 'Orphan KR', description: 'desc', priority: 'P0', parent_id: null }]
      });

      // hasExistingDecompositionTask → no existing
      pool.query.mockResolvedValueOnce({ rows: [] });

      // canCreateDecompositionTask → under WIP limit
      pool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const actions = await checkKRWithoutProject();

      expect(actions.length).toBe(1);
      expect(actions[0].action).toBe('skip_rejected');
      expect(actions[0].check).toBe('kr_without_project');
      expect(actions[0].goal_id).toBe('kr-1');
      // 退役后不再调用 createTask / 不再写 key_results.status='decomposing'
      expect(mockCreateTask).not.toHaveBeenCalled();
      expect(pool.query).toHaveBeenCalledTimes(3);
    });

    it('should skip when decomposition task already exists (dedup)', async () => {
      const { checkKRWithoutProject } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr-1', title: 'Orphan KR', description: 'desc', priority: 'P0', parent_id: null }]
      });

      // hasExistingDecompositionTask → found
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-task' }] });

      const actions = await checkKRWithoutProject();

      expect(actions.length).toBe(1);
      expect(actions[0].action).toBe('skip_dedup');
      expect(actions[0].check).toBe('kr_without_project');
    });

    it('should skip when WIP limit reached', async () => {
      const { checkKRWithoutProject } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr-1', title: 'Orphan KR', description: 'desc', priority: 'P0', parent_id: null }]
      });

      // hasExistingDecompositionTask → no existing
      pool.query.mockResolvedValueOnce({ rows: [] });

      // canCreateDecompositionTask → at WIP limit (3)
      pool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] });

      const actions = await checkKRWithoutProject();

      expect(actions.length).toBe(1);
      expect(actions[0].action).toBe('skip_wip');
      expect(actions[0].check).toBe('kr_without_project');
    });

    it('should handle no orphan KRs gracefully', async () => {
      const { checkKRWithoutProject } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({ rows: [] });

      const actions = await checkKRWithoutProject();
      expect(actions.length).toBe(0);
    });
  });

  // ─── Check D: checkObjectiveWithoutKR ───

  describe('Check D: checkObjectiveWithoutKR', () => {
    it('should create strategic_meeting task when Objective has no KR', async () => {
      const { checkObjectiveWithoutKR } = await import('../decomposition-checker.js');

      // Find objectives without KR
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'obj-1', title: 'Big Vision', description: 'grow fast', priority: 'P0', type: 'vision' }]
      });

      // hasExistingStrategicMeetingTask → no existing
      pool.query.mockResolvedValueOnce({ rows: [] });

      mockCreateTask.mockResolvedValueOnce({ task: { id: 'task-d1', title: '战略会议: 为「Big Vision」制定 KR' } });

      const actions = await checkObjectiveWithoutKR();

      expect(actions.length).toBe(1);
      expect(actions[0].action).toBe('create_strategic_meeting');
      expect(actions[0].check).toBe('objective_without_kr');
      expect(actions[0].goal_id).toBe('obj-1');
      expect(actions[0].task_id).toBe('task-d1');
    });

    it('should skip when strategic_meeting task already exists (dedup)', async () => {
      const { checkObjectiveWithoutKR } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'obj-1', title: 'Big Vision', description: 'grow', priority: 'P0', type: 'mission' }]
      });

      // hasExistingStrategicMeetingTask → found
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-meeting' }] });

      const actions = await checkObjectiveWithoutKR();

      expect(actions.length).toBe(1);
      expect(actions[0].action).toBe('skip_dedup');
      expect(actions[0].check).toBe('objective_without_kr');
    });

    it('should handle no objectives without KR gracefully', async () => {
      const { checkObjectiveWithoutKR } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({ rows: [] });

      const actions = await checkObjectiveWithoutKR();
      expect(actions.length).toBe(0);
    });
  });

  // ─── runDecompositionChecks ───

  describe('runDecompositionChecks', () => {
    it('should return summary with counts including strategic_meetings_created', async () => {
      const { runDecompositionChecks } = await import('../decomposition-checker.js');

      // Mock all queries to return empty (no work to do)
      pool.query.mockResolvedValue({ rows: [] });

      const result = await runDecompositionChecks();

      expect(result).toHaveProperty('actions');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('total_created');
      expect(result.total_created).toBe(0);
      expect(result.summary).toHaveProperty('strategic_meetings_created');
      expect(result.summary.strategic_meetings_created).toBe(0);
    });

    it('should not throw on internal errors', async () => {
      const { runDecompositionChecks } = await import('../decomposition-checker.js');

      pool.query.mockRejectedValue(new Error('DB connection failed'));

      const result = await runDecompositionChecks();

      // Inner try/catch handles errors gracefully, returns empty result
      expect(result.total_created).toBe(0);
      expect(result.actions).toEqual([]);
    });
  });

  // ─── Constants ───

  describe('exported constants', () => {
    it('WIP_LIMITS.MAX_DECOMP_IN_FLIGHT = 3', async () => {
      const { WIP_LIMITS } = await import('../decomposition-checker.js');
      expect(WIP_LIMITS.MAX_DECOMP_IN_FLIGHT).toBe(3);
    });

    it('DEDUP_WINDOW_HOURS = 24', async () => {
      const { DEDUP_WINDOW_HOURS } = await import('../decomposition-checker.js');
      expect(DEDUP_WINDOW_HOURS).toBe(24);
    });
  });

  // ─── createDecompositionTask ───

  describe('createDecompositionTask', () => {
    it('should throw when goalId is null', async () => {
      const { createDecompositionTask } = await import('../decomposition-checker.js');

      await expect(
        createDecompositionTask({
          title: 'Test',
          description: 'A sufficiently long description with implement keyword to pass quality gate',
          goalId: null,
          payload: {}
        })
      ).rejects.toThrow('Refusing to create task without goalId');
    });

    it('initiative_plan 已退役（决策 ee4842a6）→ 恒 rejected，不查库不调 createTask', async () => {
      const { createDecompositionTask } = await import('../decomposition-checker.js');

      const result = await createDecompositionTask({
        title: 'Any Task',
        description: 'irrelevant, retired path never reads it',
        goalId: 'kr-1',
        payload: {}
      });

      expect(result.rejected).toBe(true);
      expect(result.reasons[0]).toContain('layer_retired');
      expect(pool.query).not.toHaveBeenCalled();
      expect(mockCreateTask).not.toHaveBeenCalled();
    });
  });
});
