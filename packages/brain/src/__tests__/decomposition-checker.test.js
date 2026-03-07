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

describe('decomposition-checker v2.0', () => {
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const dbModule = await import('../db.js');
    pool = dbModule.default;
  });

  // ─── Check A: checkPendingKRs ───

  describe('Check A: checkPendingKRs', () => {
    it('should create decomposition task for pending KR', async () => {
      const { checkPendingKRs } = await import('../decomposition-checker.js');

      // Find pending KRs
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr-1', title: 'Test KR', description: 'desc', priority: 'P0', parent_id: 'area-1' }]
      });

      // hasExistingDecompositionTask → no existing
      pool.query.mockResolvedValueOnce({ rows: [] });

      // canCreateDecompositionTask → under WIP limit
      pool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // createDecompositionTask INSERT
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'task-1', title: 'KR 拆解: Test KR' }]
      });

      // UPDATE goals status → decomposing
      pool.query.mockResolvedValueOnce({ rows: [] });

      const actions = await checkPendingKRs();

      expect(actions.length).toBe(1);
      expect(actions[0].action).toBe('create_decomposition');
      expect(actions[0].goal_id).toBe('kr-1');
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

  describe('Check B: checkReadyKRInitiatives', () => {
    it('should create initiative_plan task for initiatives needing tasks', async () => {
      const { checkReadyKRInitiatives } = await import('../decomposition-checker.js');

      // Find ready/in_progress KRs
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr-1', title: 'Ready KR', status: 'ready' }]
      });

      // Find initiatives under this KR (no domain)
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'init-1', name: 'Test Initiative', status: 'active',
          active_tasks: '0', running_tasks: '0', domain: null
        }]
      });

      // hasExistingInitiativePlanTask: no existing task
      pool.query.mockResolvedValueOnce({ rows: [] });

      // createInitiativePlanTask: INSERT returns new task (domain passed as param, no extra SELECT)
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'task-new', title: 'Initiative 规划: Test Initiative' }] });

      const actions = await checkReadyKRInitiatives();

      const created = actions.filter(a => a.action === 'create_initiative_plan');
      expect(created.length).toBe(1);
      expect(created[0].initiative_id).toBe('init-1');
      expect(created[0].task_id).toBe('task-new');
    });

    it('should transition KR from ready to in_progress when tasks running', async () => {
      const { checkReadyKRInitiatives } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr-1', title: 'Ready KR', status: 'ready' }]
      });

      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'init-1', name: 'Active Initiative', status: 'in_progress',
          active_tasks: '2', running_tasks: '1'
        }]
      });

      // UPDATE KR status
      pool.query.mockResolvedValueOnce({ rows: [] });

      const actions = await checkReadyKRInitiatives();

      const statusChange = actions.filter(a => a.action === 'status_change');
      expect(statusChange.length).toBe(1);
      expect(statusChange[0].from).toBe('ready');
      expect(statusChange[0].to).toBe('in_progress');
    });

    it('should mark KR completed when all initiatives done', async () => {
      const { checkReadyKRInitiatives } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr-1', title: 'Almost Done KR', status: 'in_progress' }]
      });

      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'init-1', name: 'Done Initiative', status: 'completed',
          active_tasks: '0', running_tasks: '0'
        }]
      });

      // UPDATE KR status → completed
      pool.query.mockResolvedValueOnce({ rows: [] });

      const actions = await checkReadyKRInitiatives();

      const statusChange = actions.filter(a => a.action === 'status_change');
      expect(statusChange.length).toBe(1);
      expect(statusChange[0].to).toBe('completed');
    });

    it('should handle no ready KRs gracefully', async () => {
      const { checkReadyKRInitiatives } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({ rows: [] });

      const actions = await checkReadyKRInitiatives();
      expect(actions.length).toBe(0);
    });
  });

  // ─── domain-aware routing: createInitiativePlanTask ───

  describe('domain-aware routing: createInitiativePlanTask', () => {
    it('domain=coding → creates architecture_design task type', async () => {
      const { createInitiativePlanTask } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'task-arch', title: 'Initiative 规划: Coding Init' }]
      });

      await createInitiativePlanTask({
        initiativeId: 'init-coding',
        krId: 'kr-1',
        initiativeName: 'Coding Init',
        domain: 'coding',
      });

      const insertCall = pool.query.mock.calls[0];
      // $5 in the VALUES tuple is task_type
      expect(insertCall[1][4]).toBe('architecture_design');
    });

    it('domain=research → creates initiative_plan with target skill in description', async () => {
      const { createInitiativePlanTask } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'task-research', title: 'Initiative 规划: Research Init' }]
      });

      await createInitiativePlanTask({
        initiativeId: 'init-research',
        krId: 'kr-1',
        initiativeName: 'Research Init',
        domain: 'research',
      });

      const insertCall = pool.query.mock.calls[0];
      // task_type stays initiative_plan
      expect(insertCall[1][4]).toBe('initiative_plan');
      // description ($2) should contain the skill hint
      const description = insertCall[1][1];
      expect(description).toContain('/research');
    });

    it('domain=null → creates initiative_plan, no skill injected', async () => {
      const { createInitiativePlanTask } = await import('../decomposition-checker.js');

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'task-null', title: 'Initiative 规划: Plain Init' }]
      });

      await createInitiativePlanTask({
        initiativeId: 'init-plain',
        krId: 'kr-1',
        initiativeName: 'Plain Init',
        domain: null,
      });

      const insertCall = pool.query.mock.calls[0];
      expect(insertCall[1][4]).toBe('initiative_plan');
      const description = insertCall[1][1];
      expect(description).not.toContain('目标 Skill');
    });

    it('Check B passes domain from initiative row', async () => {
      const { checkReadyKRInitiatives } = await import('../decomposition-checker.js');

      // Find ready KRs
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr-1', title: 'Coding KR', status: 'ready' }]
      });

      // Find initiatives with domain=coding
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'init-coding', name: 'Coding Init', status: 'active',
          active_tasks: '0', running_tasks: '0', domain: 'coding'
        }]
      });

      // hasExistingInitiativePlanTask → no existing
      pool.query.mockResolvedValueOnce({ rows: [] });

      // INSERT returns new task
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'task-arch', title: 'Initiative 规划: Coding Init' }]
      });

      await checkReadyKRInitiatives();

      // The INSERT call should use architecture_design task type
      const insertCall = pool.query.mock.calls[3];
      expect(insertCall[1][4]).toBe('architecture_design');
    });
  });

  // ─── Check C: checkKRWithoutProject ───

  describe('Check C: checkKRWithoutProject', () => {
    it('should create decomposition task and roll back KR to decomposing when KR has no project', async () => {
      const { checkKRWithoutProject } = await import('../decomposition-checker.js');

      // Find ready/in_progress KRs with no project_kr_links
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr-1', title: 'Orphan KR', description: 'desc', priority: 'P0', parent_id: null }]
      });

      // hasExistingDecompositionTask → no existing
      pool.query.mockResolvedValueOnce({ rows: [] });

      // canCreateDecompositionTask → under WIP limit
      pool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // createDecompositionTask INSERT
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'task-c1', title: 'KR 拆解（修复）: Orphan KR' }]
      });

      // UPDATE goals status → decomposing
      pool.query.mockResolvedValueOnce({ rows: [] });

      const actions = await checkKRWithoutProject();

      expect(actions.length).toBe(1);
      expect(actions[0].action).toBe('create_decomposition');
      expect(actions[0].check).toBe('kr_without_project');
      expect(actions[0].goal_id).toBe('kr-1');
      expect(actions[0].task_id).toBe('task-c1');
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

      // INSERT strategic_meeting task
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'task-d1', title: '战略会议: 为「Big Vision」制定 KR' }]
      });

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

    it('should reject when quality gate fails', async () => {
      vi.resetModules();

      // Re-mock with failing quality gate
      vi.doMock('../task-quality-gate.js', () => ({
        validateTaskDescription: () => ({ valid: false, reasons: ['too_short'] }),
      }));
      vi.doMock('../db.js', () => ({
        default: { query: vi.fn() }
      }));
      vi.doMock('../capacity.js', () => ({
        computeCapacity: () => ({ project: { max: 2 }, initiative: { max: 9 }, task: { queuedCap: 27 } }),
        isAtCapacity: () => false,
      }));

      const { createDecompositionTask } = await import('../decomposition-checker.js');

      const result = await createDecompositionTask({
        title: 'Bad Task',
        description: 'too short',
        goalId: 'kr-1',
        payload: {}
      });

      expect(result.rejected).toBe(true);
      expect(result.reasons).toContain('too_short');
    });
  });
});
