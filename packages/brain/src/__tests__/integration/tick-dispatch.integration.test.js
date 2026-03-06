/**
 * Integration Test: tick selectNextDispatchableTask + planner planNextTask
 *
 * Uses vi.mock for DB (pool) and external APIs, but tests the real
 * logic flow across tick.js and planner.js functions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB pool
const mockPool = {
  query: vi.fn(),
};
vi.mock('../../db.js', () => ({ default: mockPool }));

// Mock external dependencies that require network/system access
vi.mock('../../alertness-actions.js', () => ({
  getMitigationState: () => ({ p2_paused: false }),
}));

// Mock LLM calls (not testing AI responses)
vi.mock('../../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue('{}'),
  default: vi.fn().mockResolvedValue('{}'),
}));

// Mock focus.js (getDailyFocus needs multiple DB queries internally)
vi.mock('../../focus.js', () => ({
  getDailyFocus: vi.fn().mockResolvedValue({ kr_ids: [], manual: false }),
  setDailyFocus: vi.fn(),
  clearDailyFocus: vi.fn(),
  getReadyKRs: vi.fn().mockResolvedValue([]),
}));

describe('Tick-Planner Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('selectNextDispatchableTask', () => {
    it('selects highest priority queued task', async () => {
      const { selectNextDispatchableTask } = await import('../../tick.js');

      mockPool.query.mockResolvedValueOnce({
        rows: [
          { id: 't1', title: 'P0 task', priority: 'P0', status: 'queued', payload: {}, project_id: null, created_at: '2026-01-01' },
          { id: 't2', title: 'P2 task', priority: 'P2', status: 'queued', payload: {}, project_id: null, created_at: '2026-01-01' },
        ],
      });

      const task = await selectNextDispatchableTask(['goal-1']);
      expect(task).not.toBeNull();
      expect(task.id).toBe('t1');
    });

    it('skips tasks with unmet dependencies', async () => {
      const { selectNextDispatchableTask } = await import('../../tick.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 't1', title: 'Dependent task', priority: 'P1', status: 'queued', payload: { depends_on: ['dep-1'] }, project_id: null, created_at: '2026-01-01' },
            { id: 't2', title: 'Free task', priority: 'P2', status: 'queued', payload: {}, project_id: null, created_at: '2026-01-01' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ count: '1' }], // dep-1 not completed
        });

      const task = await selectNextDispatchableTask(['goal-1']);
      expect(task).not.toBeNull();
      expect(task.id).toBe('t2');
    });

    it('returns null when no tasks available', async () => {
      const { selectNextDispatchableTask } = await import('../../tick.js');

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const task = await selectNextDispatchableTask(['goal-1']);
      expect(task).toBeNull();
    });
  });

  describe('planNextTask', () => {
    it('returns no_active_kr when no KRs exist', async () => {
      const { planNextTask } = await import('../../planner.js');

      // getGlobalState: Promise.all runs 6 pool.query calls (getDailyFocus is mocked)
      // 1. objectives (global_okr, area_okr)
      // 2. keyResults (kr, global_kr, area_kr)
      // 3. projects (active)
      // 4. activeTasks (queued, in_progress)
      // 5. recentCompleted
      // 6. initiativeKRResult
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // objectives
        .mockResolvedValueOnce({ rows: [] }) // keyResults
        .mockResolvedValueOnce({ rows: [] }) // projects
        .mockResolvedValueOnce({ rows: [] }) // activeTasks
        .mockResolvedValueOnce({ rows: [] }) // recentCompleted
        .mockResolvedValueOnce({ rows: [] }) // initiativeKRResult
        // skipPrPlans=false (default) → PR Plans query
        .mockResolvedValueOnce({ rows: [] }); // PR plans initiatives

      const result = await planNextTask(null, { skipAreaStreams: true });
      expect(result.planned).toBe(false);
      expect(result.reason).toBe('no_active_kr');
    });
  });
});
