/**
 * Initiative Orchestrator 单元测试
 *
 * DoD 覆盖: D1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getNextStepForInitiative,
  handlePhaseTransition,
  promoteInitiativeTasks,
  createPlanTask,
  createVerifyTask,
  checkInitiativeHealth,
  VALID_TRANSITIONS,
} from '../initiative-orchestrator.js';

// ── getNextStepForInitiative ──

describe('getNextStepForInitiative', () => {
  const makeInitiative = (phase) => ({
    id: 'init-1', name: 'Test', current_phase: phase, dod_content: [],
  });

  // plan phase
  describe('plan phase', () => {
    it('returns create_plan_task when no plan tasks exist', () => {
      const step = getNextStepForInitiative(makeInitiative('plan'), []);
      expect(step.action).toBe('create_plan_task');
    });

    it('returns waiting when plan task in flight', () => {
      const tasks = [{ task_type: 'initiative_plan', status: 'in_progress' }];
      const step = getNextStepForInitiative(makeInitiative('plan'), tasks);
      expect(step.action).toBe('waiting');
    });

    it('returns transition to review when plan completed', () => {
      const tasks = [{ task_type: 'initiative_plan', status: 'completed' }];
      const step = getNextStepForInitiative(makeInitiative('plan'), tasks);
      expect(step.action).toBe('transition');
      expect(step.from).toBe('plan');
      expect(step.to).toBe('review');
    });

    it('retries when all plan tasks failed', () => {
      const tasks = [{ task_type: 'initiative_plan', status: 'failed' }];
      const step = getNextStepForInitiative(makeInitiative('plan'), tasks);
      expect(step.action).toBe('create_plan_task');
    });
  });

  // review phase
  describe('review phase', () => {
    it('returns create_review_task when no review tasks', () => {
      const step = getNextStepForInitiative(makeInitiative('review'), []);
      expect(step.action).toBe('create_review_task');
    });

    it('returns waiting when review in flight', () => {
      const tasks = [{ task_type: 'decomp_review', status: 'queued' }];
      const step = getNextStepForInitiative(makeInitiative('review'), tasks);
      expect(step.action).toBe('waiting');
    });

    it('promotes and transitions on approved', () => {
      const tasks = [{
        task_type: 'decomp_review', status: 'completed',
        completed_at: new Date().toISOString(),
        payload: { verdict: 'approved' },
      }];
      const step = getNextStepForInitiative(makeInitiative('review'), tasks);
      expect(step.action).toBe('promote_and_transition');
      expect(step.to).toBe('dev');
    });

    it('transitions back to plan on needs_revision', () => {
      const tasks = [{
        task_type: 'decomp_review', status: 'completed',
        completed_at: new Date().toISOString(),
        payload: { verdict: 'needs_revision' },
      }];
      const step = getNextStepForInitiative(makeInitiative('review'), tasks);
      expect(step.action).toBe('transition');
      expect(step.to).toBe('plan');
    });

    it('cancels initiative on rejected', () => {
      const tasks = [{
        task_type: 'decomp_review', status: 'completed',
        completed_at: new Date().toISOString(),
        payload: { verdict: 'rejected' },
      }];
      const step = getNextStepForInitiative(makeInitiative('review'), tasks);
      expect(step.action).toBe('cancel_initiative');
    });
  });

  // dev phase
  describe('dev phase', () => {
    it('returns waiting when dev tasks in flight', () => {
      const tasks = [{ task_type: 'dev', status: 'in_progress' }];
      const step = getNextStepForInitiative(makeInitiative('dev'), tasks);
      expect(step.action).toBe('waiting');
    });

    it('transitions to verify when all dev tasks done', () => {
      const tasks = [
        { task_type: 'dev', status: 'completed', completed_at: new Date().toISOString() },
        { task_type: 'dev', status: 'completed', completed_at: new Date().toISOString() },
      ];
      const step = getNextStepForInitiative(makeInitiative('dev'), tasks);
      expect(step.action).toBe('transition');
      expect(step.to).toBe('verify');
    });

    it('replans when health check fails', () => {
      const tasks = [];
      for (let i = 0; i < 5; i++) {
        tasks.push({
          task_type: 'dev',
          status: i < 3 ? 'failed' : 'completed',
          completed_at: new Date(Date.now() - i * 1000).toISOString(),
        });
      }
      const step = getNextStepForInitiative(makeInitiative('dev'), tasks);
      expect(step.action).toBe('transition');
      expect(step.to).toBe('plan');
      expect(step.detail).toBe('health_check_failed');
    });
  });

  // verify phase
  describe('verify phase', () => {
    it('returns create_verify_task when no verify tasks', () => {
      const step = getNextStepForInitiative(makeInitiative('verify'), []);
      expect(step.action).toBe('create_verify_task');
    });

    it('returns waiting when verify in flight', () => {
      const tasks = [{ task_type: 'initiative_verify', status: 'in_progress' }];
      const step = getNextStepForInitiative(makeInitiative('verify'), tasks);
      expect(step.action).toBe('waiting');
    });

    it('completes initiative when all DoD passed', () => {
      const tasks = [{
        task_type: 'initiative_verify', status: 'completed',
        completed_at: new Date().toISOString(),
        payload: { all_dod_passed: true },
      }];
      const step = getNextStepForInitiative(makeInitiative('verify'), tasks);
      expect(step.action).toBe('complete_initiative');
    });

    it('transitions back to dev on partial DoD failure', () => {
      const tasks = [{
        task_type: 'initiative_verify', status: 'completed',
        completed_at: new Date().toISOString(),
        payload: { all_dod_passed: false },
      }];
      const step = getNextStepForInitiative(makeInitiative('verify'), tasks);
      expect(step.action).toBe('transition');
      expect(step.to).toBe('dev');
      expect(step.detail).toBe('partial_dod_failure');
    });
  });

  it('returns null for unknown phase', () => {
    const step = getNextStepForInitiative(makeInitiative('unknown'), []);
    expect(step).toBeNull();
  });
});

// ── handlePhaseTransition ──

describe('handlePhaseTransition', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }),
    };
  });

  it('succeeds for valid transition plan → review', async () => {
    const ok = await handlePhaseTransition(mockPool, { id: 'init-1' }, 'plan', 'review');
    expect(ok).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SET current_phase'),
      ['review', 'init-1', 'plan'],
    );
  });

  it('rejects invalid transition plan → dev', async () => {
    const ok = await handlePhaseTransition(mockPool, { id: 'init-1' }, 'plan', 'dev');
    expect(ok).toBe(false);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('uses optimistic lock (WHERE current_phase = $from)', async () => {
    mockPool.query.mockResolvedValue({ rowCount: 0, rows: [] });
    const ok = await handlePhaseTransition(mockPool, { id: 'init-1' }, 'review', 'dev');
    expect(ok).toBe(false);
  });

  it('handles completion (to = null)', async () => {
    const ok = await handlePhaseTransition(mockPool, { id: 'init-1' }, 'verify', null);
    expect(ok).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'completed'"),
      expect.any(Array),
    );
  });

  it('logs event on successful transition', async () => {
    await handlePhaseTransition(mockPool, { id: 'init-1' }, 'dev', 'verify');
    // Should have 2 calls: UPDATE + INSERT event
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    expect(mockPool.query.mock.calls[1][0]).toContain('initiative_phase_transition');
  });
});

// ── promoteInitiativeTasks ──

describe('promoteInitiativeTasks', () => {
  it('updates draft → queued', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rowCount: 3, rows: [{ id: '1' }, { id: '2' }, { id: '3' }] }),
    };
    const count = await promoteInitiativeTasks(mockPool, 'init-1');
    expect(count).toBe(3);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'queued'"),
      ['init-1'],
    );
  });

  it('returns 0 when no draft tasks', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };
    const count = await promoteInitiativeTasks(mockPool, 'init-1');
    expect(count).toBe(0);
  });
});

// ── createPlanTask ──

describe('createPlanTask', () => {
  it('creates initiative_plan task', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'task-1', task_type: 'initiative_plan', status: 'queued' }],
      }),
    };
    const initiative = { id: 'init-1', name: 'Test Initiative', dod_content: [], description: 'test' };
    const task = await createPlanTask(mockPool, initiative, 'kr-1', '/repo/path');
    expect(task.task_type).toBe('initiative_plan');
    expect(mockPool.query.mock.calls[0][1][0]).toBe('Plan: Test Initiative');
  });
});

// ── createVerifyTask ──

describe('createVerifyTask', () => {
  it('creates initiative_verify task', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'task-2', task_type: 'initiative_verify', status: 'queued' }],
      }),
    };
    const initiative = { id: 'init-1', name: 'Test Initiative', dod_content: [] };
    const devTasks = [{ id: 't1', title: 'Dev 1', status: 'completed' }];
    const task = await createVerifyTask(mockPool, initiative, devTasks, 'kr-1');
    expect(task.task_type).toBe('initiative_verify');
    expect(mockPool.query.mock.calls[0][1][0]).toBe('Verify: Test Initiative');
  });
});

// ── checkInitiativeHealth ──

describe('checkInitiativeHealth', () => {
  it('returns replan=false when < 5 tasks', () => {
    const tasks = [
      { task_type: 'dev', status: 'failed', completed_at: new Date().toISOString() },
    ];
    const result = checkInitiativeHealth(tasks);
    expect(result.replan).toBe(false);
  });

  it('returns replan=true when 3/5 recent tasks failed', () => {
    const tasks = [];
    for (let i = 0; i < 5; i++) {
      tasks.push({
        task_type: 'dev',
        status: i < 3 ? 'failed' : 'completed',
        completed_at: new Date(Date.now() - i * 1000).toISOString(),
      });
    }
    const result = checkInitiativeHealth(tasks);
    expect(result.replan).toBe(true);
    expect(result.reason).toContain('3/5');
  });

  it('returns replan=false when 2/5 recent tasks failed', () => {
    const tasks = [];
    for (let i = 0; i < 5; i++) {
      tasks.push({
        task_type: 'dev',
        status: i < 2 ? 'failed' : 'completed',
        completed_at: new Date(Date.now() - i * 1000).toISOString(),
      });
    }
    const result = checkInitiativeHealth(tasks);
    expect(result.replan).toBe(false);
  });
});

// ── VALID_TRANSITIONS ──

describe('VALID_TRANSITIONS', () => {
  it('plan can transition to review', () => {
    expect(VALID_TRANSITIONS['plan']).toContain('review');
  });

  it('review can transition to dev or plan', () => {
    expect(VALID_TRANSITIONS['review']).toContain('dev');
    expect(VALID_TRANSITIONS['review']).toContain('plan');
  });

  it('dev can transition to verify or plan', () => {
    expect(VALID_TRANSITIONS['dev']).toContain('verify');
    expect(VALID_TRANSITIONS['dev']).toContain('plan');
  });

  it('verify can transition to dev or null (complete)', () => {
    expect(VALID_TRANSITIONS['verify']).toContain('dev');
    expect(VALID_TRANSITIONS['verify']).toContain(null);
  });
});
