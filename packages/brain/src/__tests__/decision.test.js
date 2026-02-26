/**
 * Tests for Decision Engine (decision.js)
 * Focuses on confidence calculation, safe action splitting, and retry_count filtering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database pool before importing
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

import pool from '../db.js';
import { splitActionsBySafety, SAFE_ACTIONS } from '../decision.js';

describe('decision engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SAFE_ACTIONS', () => {
    it('should include retry, reprioritize, and skip', () => {
      expect(SAFE_ACTIONS.has('retry')).toBe(true);
      expect(SAFE_ACTIONS.has('reprioritize')).toBe(true);
      expect(SAFE_ACTIONS.has('skip')).toBe(true);
    });

    it('should NOT include escalate', () => {
      expect(SAFE_ACTIONS.has('escalate')).toBe(false);
    });
  });

  describe('splitActionsBySafety', () => {
    it('should separate safe and unsafe actions', () => {
      const actions = [
        { type: 'retry', target_id: '1' },
        { type: 'escalate', target_id: '2' },
        { type: 'reprioritize', target_id: '3' },
      ];

      const { safeActions, unsafeActions } = splitActionsBySafety(actions);

      expect(safeActions).toHaveLength(2);
      expect(unsafeActions).toHaveLength(1);
      expect(safeActions.map(a => a.type)).toEqual(['retry', 'reprioritize']);
      expect(unsafeActions[0].type).toBe('escalate');
    });

    it('should return all safe when no unsafe actions', () => {
      const actions = [
        { type: 'retry', target_id: '1' },
        { type: 'skip', target_id: '2' },
      ];

      const { safeActions, unsafeActions } = splitActionsBySafety(actions);

      expect(safeActions).toHaveLength(2);
      expect(unsafeActions).toHaveLength(0);
    });

    it('should return all unsafe when no safe actions', () => {
      const actions = [
        { type: 'escalate', target_id: '1' },
      ];

      const { safeActions, unsafeActions } = splitActionsBySafety(actions);

      expect(safeActions).toHaveLength(0);
      expect(unsafeActions).toHaveLength(1);
    });

    it('should handle empty actions array', () => {
      const { safeActions, unsafeActions } = splitActionsBySafety([]);

      expect(safeActions).toHaveLength(0);
      expect(unsafeActions).toHaveLength(0);
    });
  });

  describe('generateDecision confidence', () => {
    it('should maintain high confidence for retry-only decisions', async () => {
      // Import after mocks are set up
      const { generateDecision } = await import('../decision.js');

      // Mock: no goals with issues
      pool.query
        // 1st call: goals query
        .mockResolvedValueOnce({ rows: [] })
        // 2nd call: failed tasks query — one failed task with low retry count
        .mockResolvedValueOnce({
          rows: [{ id: 'task-1', title: 'Failed Task', goal_id: null }]
        })
        // 3rd call: INSERT INTO decisions
        .mockResolvedValueOnce({
          rows: [{ id: 'decision-123' }]
        });

      const result = await generateDecision({ trigger: 'tick' });

      // Confidence should stay at 0.9 (not dropped to 0.7)
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('retry');
      // Should NOT require approval since confidence >= 0.8
      expect(result.requires_approval).toBe(false);
    });

    it('should filter out tasks with retry_count >= 3', async () => {
      const { generateDecision } = await import('../decision.js');

      // Mock: no goals, no failed tasks (all exhausted)
      pool.query
        .mockResolvedValueOnce({ rows: [] })         // goals
        .mockResolvedValueOnce({ rows: [] })          // failed tasks (filtered by retry_count < 3)
        .mockResolvedValueOnce({                      // INSERT
          rows: [{ id: 'decision-456' }]
        });

      const result = await generateDecision({ trigger: 'tick' });

      expect(result.actions).toHaveLength(0);
      expect(result.confidence).toBe(0.9);
    });

    it('should lower confidence for escalate actions but not retry', async () => {
      const { generateDecision } = await import('../decision.js');

      // Mock: one goal with blocked tasks
      pool.query
        // goals query
        .mockResolvedValueOnce({
          rows: [{
            id: 'goal-1',
            title: 'Test Goal',
            status: 'behind',
            progress: 10,
            created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            total_tasks: 5,
            completed_tasks: 1,
            in_progress_tasks: 1
          }]
        })
        // tasks for blocked check
        .mockResolvedValueOnce({
          rows: [{
            id: 'blocked-task',
            status: 'in_progress',
            started_at: new Date(Date.now() - 48 * 60 * 60 * 1000) // 48 hours ago
          }]
        })
        // pending tasks for reprioritize
        .mockResolvedValueOnce({
          rows: [{ id: 'pending-task', title: 'Task A', priority: 'P2' }]
        })
        // failed tasks
        .mockResolvedValueOnce({
          rows: [{ id: 'failed-task', title: 'Failed B', goal_id: null }]
        })
        // INSERT
        .mockResolvedValueOnce({
          rows: [{ id: 'decision-789' }]
        });

      const result = await generateDecision({ trigger: 'tick' });

      // Should have escalate (from blocked) + reprioritize + retry
      const types = result.actions.map(a => a.type);
      expect(types).toContain('escalate');
      expect(types).toContain('retry');
      // Confidence should be 0.85 (from escalate), NOT 0.7
      expect(result.confidence).toBe(0.85);
    });
  });

  describe('decision status on creation', () => {
    it('should set status to approved when confidence >= threshold', async () => {
      const { generateDecision } = await import('../decision.js');

      const insertSpy = pool.query
        .mockResolvedValueOnce({ rows: [] })         // goals
        .mockResolvedValueOnce({ rows: [] })          // failed tasks
        .mockResolvedValueOnce({                      // INSERT
          rows: [{ id: 'decision-ok' }]
        });

      await generateDecision({ trigger: 'tick' });

      // The INSERT call is the 3rd one
      const insertCall = insertSpy.mock.calls[2];
      // 5th param is status
      expect(insertCall[1][4]).toBe('approved');
    });
  });
});
