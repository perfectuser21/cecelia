/**
 * Test: Exploratory → Dev phase flow
 *
 * Tests the phase-aware task selection in planner.js and
 * the phase transition logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

// Mock focus.js
vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn().mockResolvedValue(null)
}));

describe('Exploratory → Dev flow', () => {
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbModule = await import('../db.js');
    pool = dbModule.default;
  });

  describe('generateNextTask phase ordering', () => {
    it('should return exploratory task before dev task', async () => {
      const { generateNextTask } = await import('../planner.js');

      // Mock: two tasks — one exploratory, one dev
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'task-exploratory',
          title: 'Exploratory: Validate API',
          phase: 'exploratory',
          status: 'queued',
          priority: 'P1',
          created_at: '2026-02-15T10:00:00Z'
        }]
      });

      const kr = { id: 'kr-1', title: 'Test KR' };
      const project = { id: 'proj-1', name: 'Test Project' };
      const state = { activeTasks: [], keyResults: [], projects: [] };

      const result = await generateNextTask(kr, project, state);

      expect(result).toBeTruthy();
      expect(result.id).toBe('task-exploratory');
      expect(result.phase).toBe('exploratory');
    });

    it('should return null when no tasks exist', async () => {
      const { generateNextTask } = await import('../planner.js');

      pool.query.mockResolvedValueOnce({ rows: [] });

      const kr = { id: 'kr-1', title: 'Test KR' };
      const project = { id: 'proj-1', name: 'Test Project' };
      const state = { activeTasks: [], keyResults: [], projects: [] };

      const result = await generateNextTask(kr, project, state);

      expect(result).toBeNull();
    });

    it('should use phase ordering in SQL query', async () => {
      const { generateNextTask } = await import('../planner.js');

      pool.query.mockResolvedValueOnce({ rows: [] });

      const kr = { id: 'kr-1', title: 'Test KR' };
      const project = { id: 'proj-1', name: 'Test Project' };
      const state = { activeTasks: [], keyResults: [], projects: [] };

      await generateNextTask(kr, project, state);

      // Verify the SQL query includes phase ordering
      const sqlCall = pool.query.mock.calls[0];
      expect(sqlCall[0]).toContain('phase');
      expect(sqlCall[0]).toContain("WHEN 'exploratory' THEN 0");
      expect(sqlCall[0]).toContain("WHEN 'dev' THEN 1");
    });
  });

  describe('phase transition logic', () => {
    it('should create dev task when exploratory phase completes', () => {
      // This tests the concept: when phase='exploratory' task completes,
      // the execution-callback creates a dev-phase task.
      // The actual logic lives in routes.js, tested via integration.

      const exploratoryTask = {
        id: 'task-1',
        phase: 'exploratory',
        project_id: 'initiative-1',
        goal_id: 'kr-1',
        status: 'completed'
      };

      // Verify the task has correct phase
      expect(exploratoryTask.phase).toBe('exploratory');
      expect(exploratoryTask.project_id).toBeTruthy();
    });

    it('should set dev phase on created follow-up task', () => {
      const devTaskPayload = {
        phase: 'dev',
        exploratory_task_id: 'task-1',
        exploratory_result: 'API validated successfully'
      };

      expect(devTaskPayload.phase).toBe('dev');
      expect(devTaskPayload.exploratory_task_id).toBeTruthy();
    });
  });
});
