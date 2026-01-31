import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../task-system/db.js', () => ({
  default: { query: vi.fn() }
}));
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn() }));
vi.mock('../actions.js', () => ({
  updateTask: vi.fn(), createTask: vi.fn(), createGoal: vi.fn(),
  updateGoal: vi.fn(), triggerN8n: vi.fn(), setMemory: vi.fn(),
  batchUpdateTasks: vi.fn()
}));
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn(), checkCeceliaRunAvailable: vi.fn(),
  getActiveProcessCount: vi.fn(() => 0), killProcess: vi.fn(() => true),
  cleanupOrphanProcesses: vi.fn(() => 0),
  checkServerResources: vi.fn(() => ({ ok: true, reason: null, metrics: {} })),
}));
vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn(), generateDecision: vi.fn(), executeDecision: vi.fn()
}));

import pool from '../../task-system/db.js';
import { updateTask } from '../actions.js';
import { triggerCeceliaRun, checkCeceliaRunAvailable } from '../executor.js';
import {
  dispatchNextTask,
  selectNextDispatchableTask,
  autoFailTimedOutTasks,
  DISPATCH_TIMEOUT_MINUTES,
  DISPATCH_COOLDOWN_MS,
  MAX_CONCURRENT_TASKS
} from '../tick.js';

const goalIds = ['goal-1', 'kr-1'];

describe('Tick Dispatch constants', () => {
  it('DISPATCH_TIMEOUT_MINUTES is 60', () => {
    expect(DISPATCH_TIMEOUT_MINUTES).toBe(60);
  });
  it('DISPATCH_COOLDOWN_MS is 60 seconds', () => {
    expect(DISPATCH_COOLDOWN_MS).toBe(60 * 1000);
  });
  it('MAX_CONCURRENT_TASKS defaults to 3', () => {
    expect(MAX_CONCURRENT_TASKS).toBe(3);
  });
});

describe('selectNextDispatchableTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns first queued task with no dependencies', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 'task-1', title: 'Task 1', status: 'queued', priority: 'P0', payload: null },
        { id: 'task-2', title: 'Task 2', status: 'queued', priority: 'P1', payload: null }
      ]
    });

    const task = await selectNextDispatchableTask(goalIds);
    expect(task.id).toBe('task-1');
  });

  it('skips task with unmet dependencies', async () => {
    pool.query
      // First call: queued tasks
      .mockResolvedValueOnce({
        rows: [
          { id: 'task-1', title: 'Blocked', status: 'queued', priority: 'P0', payload: { depends_on: ['dep-1'] } },
          { id: 'task-2', title: 'Available', status: 'queued', priority: 'P1', payload: null }
        ]
      })
      // Second call: check dep-1 status (not completed)
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const task = await selectNextDispatchableTask(goalIds);
    expect(task.id).toBe('task-2');
  });

  it('returns task with met dependencies', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          { id: 'task-1', title: 'Has deps', status: 'queued', priority: 'P0', payload: { depends_on: ['dep-1'] } }
        ]
      })
      // dep-1 is completed (count = 0 not completed)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const task = await selectNextDispatchableTask(goalIds);
    expect(task.id).toBe('task-1');
  });

  it('returns null when no dispatchable tasks', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const task = await selectNextDispatchableTask(goalIds);
    expect(task).toBeNull();
  });
});

describe('dispatchNextTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Advance time well past any cooldown from previous tests
    vi.advanceTimersByTime(DISPATCH_COOLDOWN_MS + 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns max_concurrent_reached when at capacity', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] }); // active count >= MAX_CONCURRENT (3)

    const result = await dispatchNextTask(goalIds);
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('max_concurrent_reached');
  });

  it('returns no_dispatchable_task when queue empty', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // active count = 0
      .mockResolvedValueOnce({ rows: [] }); // no queued tasks

    const result = await dispatchNextTask(goalIds);
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('no_dispatchable_task');
  });

  it('dispatches task and triggers cecelia-run', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // active count = 0
      .mockResolvedValueOnce({ // queued tasks
        rows: [{ id: 'task-1', title: 'Build feature', status: 'queued', priority: 'P0', payload: null }]
      })
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', title: 'Build feature', payload: {} }] }) // full task
      .mockResolvedValueOnce({ rows: [] }) // working_memory insert
      .mockResolvedValueOnce({ rows: [] }); // decision_log insert

    updateTask.mockResolvedValueOnce({ success: true });
    checkCeceliaRunAvailable.mockResolvedValueOnce({ available: true });
    triggerCeceliaRun.mockResolvedValueOnce({ success: true, runId: 'run-123' });

    const result = await dispatchNextTask(goalIds);
    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe('task-1');
    expect(result.run_id).toBe('run-123');
    expect(updateTask).toHaveBeenCalledWith({ task_id: 'task-1', status: 'in_progress' });
    expect(triggerCeceliaRun).toHaveBeenCalled();
  });

  it('dispatches but skips cecelia-run when unavailable', async () => {
    // Advance past cooldown from previous test's dispatch
    vi.setSystemTime(Date.now() + DISPATCH_COOLDOWN_MS + 1000);

    pool.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'task-1', title: 'Task', status: 'queued', priority: 'P0', payload: null }]
      })
      .mockResolvedValueOnce({ rows: [] }); // decision_log

    updateTask.mockResolvedValueOnce({ success: true });
    checkCeceliaRunAvailable.mockResolvedValueOnce({ available: false, error: 'not found' });

    const result = await dispatchNextTask(goalIds);
    expect(result.dispatched).toBe(true);
    expect(result.reason).toBe('no_executor');
    expect(triggerCeceliaRun).not.toHaveBeenCalled();
  });
});

describe('autoFailTimedOutTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-fails task past timeout', async () => {
    const triggeredAt = new Date(Date.now() - 65 * 60 * 1000).toISOString();
    updateTask.mockResolvedValueOnce({ success: true });
    pool.query.mockResolvedValue({ rows: [] }); // decision_log

    const actions = await autoFailTimedOutTasks([
      { id: 'task-1', title: 'Old task', status: 'in_progress', started_at: triggeredAt, payload: { run_triggered_at: triggeredAt } }
    ]);

    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('auto-fail-timeout');
    expect(updateTask).toHaveBeenCalledWith({ task_id: 'task-1', status: 'failed' });
  });

  it('does not fail task within timeout', async () => {
    const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const actions = await autoFailTimedOutTasks([
      { id: 'task-1', title: 'Recent task', status: 'in_progress', started_at: recentTime, payload: {} }
    ]);

    expect(actions.length).toBe(0);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('uses started_at as fallback when run_triggered_at missing', async () => {
    const oldTime = new Date(Date.now() - 70 * 60 * 1000).toISOString();
    updateTask.mockResolvedValueOnce({ success: true });
    pool.query.mockResolvedValue({ rows: [] });

    const actions = await autoFailTimedOutTasks([
      { id: 'task-1', title: 'No trigger', status: 'in_progress', started_at: oldTime, payload: {} }
    ]);

    expect(actions.length).toBe(1);
    expect(actions[0].elapsed_minutes).toBeGreaterThan(60);
  });
});

describe('getTickStatus includes dispatch fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('returns dispatch-related fields', async () => {
    const { getTickStatus } = await import('../tick.js');
    const status = await getTickStatus();
    expect(status).toHaveProperty('last_dispatch');
    expect(status).toHaveProperty('max_concurrent');
    expect(status).toHaveProperty('dispatch_timeout_minutes');
    expect(status.max_concurrent).toBe(3); // default from env CECELIA_MAX_CONCURRENT || 3
    expect(status.dispatch_timeout_minutes).toBe(60);
    expect(status.last_dispatch).toBeNull();
  });
});
