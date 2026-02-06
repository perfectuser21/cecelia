/**
 * Tests for Decision Executor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeDecision, actionHandlers } from '../decision-executor.js';

// Mock the database pool
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [{ id: 'test-id' }] })
  }
}));

// Mock actions.js
vi.mock('../actions.js', () => ({
  createTask: vi.fn().mockResolvedValue({ success: true, task: { id: 'new-task-id' } }),
  updateTask: vi.fn().mockResolvedValue({ success: true })
}));

// Mock tick.js dispatchNextTask
vi.mock('../tick.js', () => ({
  dispatchNextTask: vi.fn().mockResolvedValue({ dispatched: true, task_id: 'dispatched-task' })
}));

describe('decision-executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeDecision', () => {
    it('should execute valid decision successfully', async () => {
      const decision = {
        level: 1,
        actions: [{ type: 'no_action', params: {} }],
        rationale: 'Test execution',
        confidence: 0.9,
        safety: false
      };

      const report = await executeDecision(decision);

      expect(report.success).toBe(true);
      expect(report.decision_level).toBe(1);
      expect(report.actions_executed).toHaveLength(1);
      expect(report.actions_failed).toHaveLength(0);
      expect(report.completed_at).toBeDefined();
    });

    it('should fail for invalid decision', async () => {
      const decision = {
        level: 5, // Invalid level
        actions: [],
        rationale: 'Test',
        confidence: 0.9,
        safety: false
      };

      const report = await executeDecision(decision);

      expect(report.success).toBe(false);
      expect(report.error).toContain('Invalid decision');
    });

    it('should fail for dangerous actions without safety flag', async () => {
      const decision = {
        level: 1,
        actions: [{ type: 'request_human_review', params: { reason: 'test' } }],
        rationale: 'Test dangerous action',
        confidence: 0.9,
        safety: false // Missing safety flag
      };

      const report = await executeDecision(decision);

      expect(report.success).toBe(false);
      expect(report.error).toContain('Dangerous actions require safety: true');
    });

    it('should allow dangerous actions with safety flag', async () => {
      const decision = {
        level: 1,
        actions: [{ type: 'request_human_review', params: { reason: 'test' } }],
        rationale: 'Test dangerous action with safety',
        confidence: 0.9,
        safety: true
      };

      const report = await executeDecision(decision);

      expect(report.success).toBe(true);
      expect(report.requires_human).toBe(true);
    });

    it('should handle unknown action type gracefully', async () => {
      // This test checks graceful handling even though validation should catch it
      const decision = {
        level: 1,
        actions: [{ type: 'unknown_action', params: {} }],
        rationale: 'Test unknown action',
        confidence: 0.9,
        safety: false
      };

      const report = await executeDecision(decision);

      // Should fail validation before execution
      expect(report.success).toBe(false);
    });

    it('should execute multiple actions in sequence', async () => {
      const decision = {
        level: 1,
        actions: [
          { type: 'no_action', params: {} },
          { type: 'log_event', params: { event_type: 'test', data: {} } }
        ],
        rationale: 'Test multiple actions',
        confidence: 0.9,
        safety: false
      };

      const report = await executeDecision(decision);

      expect(report.success).toBe(true);
      expect(report.actions_executed.length).toBe(2);
    });
  });

  describe('actionHandlers', () => {
    describe('no_action', () => {
      it('should return success with no operation', async () => {
        const result = await actionHandlers.no_action({}, {});
        expect(result.success).toBe(true);
        expect(result.action).toBe('none');
      });
    });

    describe('fallback_to_tick', () => {
      it('should return success with fallback flag', async () => {
        const result = await actionHandlers.fallback_to_tick({}, {});
        expect(result.success).toBe(true);
        expect(result.fallback).toBe(true);
      });
    });

    describe('dispatch_task', () => {
      it('should call dispatchNextTask', async () => {
        const result = await actionHandlers.dispatch_task({ trigger: 'test' }, {});
        expect(result.success).toBe(true);
        expect(result.dispatched).toBeDefined();
      });
    });

    describe('create_task', () => {
      it('should create task with provided params', async () => {
        const params = {
          title: 'Test Task',
          description: 'Test description',
          task_type: 'dev',
          priority: 'P1'
        };

        const result = await actionHandlers.create_task(params, {});
        expect(result.success).toBe(true);
        expect(result.task_id).toBe('new-task-id');
      });
    });

    describe('cancel_task', () => {
      it('should update task status to cancelled', async () => {
        const result = await actionHandlers.cancel_task({ task_id: 'test-id' }, {});
        expect(result.success).toBe(true);
      });
    });

    describe('retry_task', () => {
      it('should update task status to queued', async () => {
        const result = await actionHandlers.retry_task({ task_id: 'test-id' }, {});
        expect(result.success).toBe(true);
      });
    });

    describe('notify_user', () => {
      it('should log notification and record event', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const result = await actionHandlers.notify_user({ message: 'Test notification' }, {});

        expect(result.success).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Notify user'));

        consoleSpy.mockRestore();
      });
    });

    describe('log_event', () => {
      it('should insert event into database', async () => {
        const result = await actionHandlers.log_event({
          event_type: 'test_event',
          data: { key: 'value' }
        }, {});

        expect(result.success).toBe(true);
      });
    });

    describe('escalate_to_brain', () => {
      it('should create task for brain escalation', async () => {
        const result = await actionHandlers.escalate_to_brain({
          reason: 'Complex decision needed',
          context: 'Test context'
        }, {});

        expect(result.success).toBe(true);
        expect(result.task_id).toBeDefined();
      });
    });

    describe('request_human_review', () => {
      it('should record review request and return requires_human', async () => {
        const result = await actionHandlers.request_human_review({
          reason: 'Need human approval'
        }, {});

        expect(result.success).toBe(true);
        expect(result.requires_human).toBe(true);
      });
    });

    describe('analyze_failure', () => {
      it('should create analysis task', async () => {
        const result = await actionHandlers.analyze_failure({
          task_id: 'failed-task-id',
          task_title: 'Failed Task',
          retry_count: 3,
          error: 'Test error'
        }, {});

        expect(result.success).toBe(true);
        expect(result.analysis_task_id).toBeDefined();
      });
    });

    describe('predict_progress', () => {
      it('should return not_implemented for now', async () => {
        const result = await actionHandlers.predict_progress({ goal_id: 'test-goal' }, {});

        expect(result.success).toBe(true);
        expect(result.prediction).toBe('not_implemented');
      });
    });

    describe('create_okr', () => {
      it('should insert goal into database', async () => {
        const result = await actionHandlers.create_okr({
          title: 'Test OKR',
          description: 'Test description',
          type: 'objective',
          priority: 'P0'
        }, {});

        expect(result.success).toBe(true);
        expect(result.goal_id).toBeDefined();
      });
    });

    describe('update_okr_progress', () => {
      it('should update goal progress', async () => {
        const result = await actionHandlers.update_okr_progress({
          goal_id: 'test-goal',
          progress: 50
        }, {});

        expect(result.success).toBe(true);
      });
    });

    describe('assign_to_autumnrice', () => {
      it('should create decomposition task', async () => {
        const result = await actionHandlers.assign_to_autumnrice({
          okr_title: 'Test OKR',
          okr_description: 'Description',
          goal_id: 'goal-id'
        }, {});

        expect(result.success).toBe(true);
        expect(result.task_id).toBeDefined();
      });
    });

    describe('reprioritize_task', () => {
      it('should update task priority', async () => {
        const result = await actionHandlers.reprioritize_task({
          task_id: 'test-task',
          priority: 'P0'
        }, {});

        expect(result.success).toBe(true);
      });
    });
  });
});
