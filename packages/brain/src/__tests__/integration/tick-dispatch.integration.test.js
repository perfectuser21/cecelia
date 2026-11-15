/**
 * Integration Test: tick selectNextDispatchableTask
 *
 * Uses vi.mock for DB (pool) and external APIs, but tests the real
 * task dispatch selection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB pool
const mockPool = {
  query: vi.fn(),
};
vi.mock('../../db.js', () => ({ default: mockPool }));

// Mock external dependencies that require network/system access

// Mock LLM calls (not testing AI responses)
vi.mock('../../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue('{}'),
  default: vi.fn().mockResolvedValue('{}'),
}));

describe('Tick dispatch selection', () => {
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

});
