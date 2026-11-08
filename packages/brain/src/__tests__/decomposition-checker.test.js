/** 旧拆解已退役；验证缺 KR 的目标检查与兼容入口。 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

const mockCreateTask = vi.hoisted(() => vi.fn());
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));

describe('目标缺少 KR 检查', () => {
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCreateTask.mockResolvedValue({ task: { id: 'task-1', title: 'routed task' } });
    const dbModule = await import('../db.js');
    pool = dbModule.default;
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
    it('只处理缺 KR 的目标，不再查询或触发退役的 KR 拆解', async () => {
      const { runDecompositionChecks } = await import('../decomposition-checker.js');
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'obj-1', title: '目标' }] });
      pool.query.mockResolvedValueOnce({ rows: [] });
      const result = await runDecompositionChecks();
      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query.mock.calls[0][0]).toContain('FROM objectives');
      expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({ task_type: 'strategic_meeting', goal_id: 'obj-1' }));
      expect(result.summary.strategic_meetings_created).toBe(1);
      expect(result.total_created).toBe(0);
    });
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

});
