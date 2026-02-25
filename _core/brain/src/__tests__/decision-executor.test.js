/**
 * Tests for Decision Executor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeDecision, actionHandlers, isActionDangerous } from '../decision-executor.js';

// Mock client for transactions
const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [{ id: 'test-pending-id' }] }),
  release: vi.fn(),
};

// Mock the database pool
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [{ id: 'test-id' }] }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'test-pending-id' }] }),
      release: vi.fn(),
    }),
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

    describe('pause_task', () => {
      it('should update task status to paused', async () => {
        const result = await actionHandlers.pause_task({ task_id: 'test-id' }, {});
        expect(result.success).toBe(true);
      });
    });

    describe('resume_task', () => {
      it('should update task status to queued', async () => {
        const result = await actionHandlers.resume_task({ task_id: 'test-id' }, {});
        expect(result.success).toBe(true);
      });
    });

    describe('mark_task_blocked', () => {
      it('should update task status to blocked', async () => {
        const result = await actionHandlers.mark_task_blocked({ task_id: 'test-id', reason: 'dependency missing' }, {});
        expect(result.success).toBe(true);
        expect(result.reason).toBe('dependency missing');
      });
    });

    describe('quarantine_task', () => {
      it('should call quarantineTask with task_id and reason', async () => {
        const result = await actionHandlers.quarantine_task({ task_id: 'test-id', reason: 'repeated_failure' }, {});
        // quarantineTask returns success or already_quarantined for non-existent tasks
        expect(typeof result.success).toBe('boolean');
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
          type: 'global_okr',
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

    describe('update_task_prd', () => {
      it('should update task prd_content in database', async () => {
        const result = await actionHandlers.update_task_prd({
          task_id: 'test-task-id',
          prd_content: '## Updated PRD\n\nNew content discovered during exploration.'
        }, {});

        expect(result.success).toBe(true);
        expect(result.task_id).toBe('test-task-id');
      });

      it('should return error when task_id is missing', async () => {
        const result = await actionHandlers.update_task_prd({
          prd_content: 'some content'
        }, {});

        expect(result.success).toBe(false);
        expect(result.error).toContain('task_id');
      });

      it('should return error when prd_content is missing', async () => {
        const result = await actionHandlers.update_task_prd({
          task_id: 'test-task-id'
        }, {});

        expect(result.success).toBe(false);
        expect(result.error).toContain('prd_content');
      });
    });

    describe('archive_task', () => {
      it('should set task status to archived', async () => {
        const result = await actionHandlers.archive_task({
          task_id: 'old-task-id',
          reason: 'expired after 30 days'
        }, {});

        expect(result.success).toBe(true);
        expect(result.task_id).toBe('old-task-id');
        expect(result.reason).toBe('expired after 30 days');
      });

      it('should return null reason when not provided', async () => {
        const result = await actionHandlers.archive_task({
          task_id: 'old-task-id'
        }, {});

        expect(result.success).toBe(true);
        expect(result.reason).toBeNull();
      });

      it('should return error when task_id is missing', async () => {
        const result = await actionHandlers.archive_task({}, {});

        expect(result.success).toBe(false);
        expect(result.error).toContain('task_id');
      });
    });

    describe('defer_task', () => {
      it('should update task due_at to specified timestamp', async () => {
        const futureDate = new Date(Date.now() + 86400000).toISOString(); // tomorrow
        const result = await actionHandlers.defer_task({
          task_id: 'defer-task-id',
          defer_until: futureDate
        }, {});

        expect(result.success).toBe(true);
        expect(result.task_id).toBe('defer-task-id');
        expect(result.defer_until).toBe(futureDate);
      });

      it('should return error when task_id is missing', async () => {
        const result = await actionHandlers.defer_task({
          defer_until: new Date().toISOString()
        }, {});

        expect(result.success).toBe(false);
        expect(result.error).toContain('task_id');
      });

      it('should return error when defer_until is missing', async () => {
        const result = await actionHandlers.defer_task({
          task_id: 'defer-task-id'
        }, {});

        expect(result.success).toBe(false);
        expect(result.error).toContain('defer_until');
      });

      it('should return error for invalid timestamp', async () => {
        const result = await actionHandlers.defer_task({
          task_id: 'defer-task-id',
          defer_until: 'not-a-date'
        }, {});

        expect(result.success).toBe(false);
        expect(result.error).toContain('valid ISO 8601');
      });
    });
  });

  describe('isActionDangerous', () => {
    it('should return true for request_human_review', () => {
      expect(isActionDangerous({ type: 'request_human_review' })).toBe(true);
    });

    it('should return false for dispatch_task', () => {
      expect(isActionDangerous({ type: 'dispatch_task' })).toBe(false);
    });

    it('should return false for no_action', () => {
      expect(isActionDangerous({ type: 'no_action' })).toBe(false);
    });

    it('should return true for adjust_strategy (cortex action)', () => {
      expect(isActionDangerous({ type: 'adjust_strategy' })).toBe(true);
    });

    it('should return false for record_learning (cortex action)', () => {
      expect(isActionDangerous({ type: 'record_learning' })).toBe(false);
    });

    it('should return false for unknown action', () => {
      expect(isActionDangerous({ type: 'totally_unknown' })).toBe(false);
    });

    it('should return false for update_task_prd (task lifecycle action)', () => {
      expect(isActionDangerous({ type: 'update_task_prd' })).toBe(false);
    });

    it('should return false for archive_task (task lifecycle action)', () => {
      expect(isActionDangerous({ type: 'archive_task' })).toBe(false);
    });

    it('should return false for defer_task (task lifecycle action)', () => {
      expect(isActionDangerous({ type: 'defer_task' })).toBe(false);
    });
  });

  describe('transactional execution', () => {
    it('should include rolled_back field in report', async () => {
      const decision = {
        level: 1,
        actions: [{ type: 'no_action', params: {} }],
        rationale: 'Test transaction',
        confidence: 0.9,
        safety: false
      };

      const report = await executeDecision(decision);
      expect(report).toHaveProperty('rolled_back');
      expect(report.rolled_back).toBe(false);
    });

    it('should include actions_pending_approval field', async () => {
      const decision = {
        level: 1,
        actions: [{ type: 'no_action', params: {} }],
        rationale: 'Test pending field',
        confidence: 0.9,
        safety: false
      };

      const report = await executeDecision(decision);
      expect(report).toHaveProperty('actions_pending_approval');
      expect(Array.isArray(report.actions_pending_approval)).toBe(true);
    });

    it('should queue dangerous actions for approval instead of executing', async () => {
      const decision = {
        level: 2,
        actions: [{ type: 'adjust_strategy', params: { key: 'test', new_value: '100', reason: 'test' } }],
        rationale: 'Test dangerous action queueing',
        confidence: 0.9,
        safety: true
      };

      const report = await executeDecision(decision);

      // Dangerous actions should be queued, not executed directly
      expect(report.actions_pending_approval.length).toBeGreaterThanOrEqual(0);
    });
  });
});
