/**
 * Tests for queued state deduplication behavior
 *
 * Target: verify dedup logic correctly identifies and skips duplicate tasks
 * when they are in queued status.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

describe('Dedup: queued state handling', () => {
  let pool;
  let createTask;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const dbModule = await import('../db.js');
    pool = dbModule.default;
    const actions = await import('../actions.js');
    createTask = actions.createTask;
  });

  it('dedup detects task with same title in queued status', async () => {
    // Simulate existing task in queued status
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'existing-queued-001',
        title: 'Test Task',
        status: 'queued',
        goal_id: 'kr-001',
        project_id: 'proj-001'
      }]
    });

    const result = await createTask({
      title: 'Test Task',
      goal_id: 'kr-001',
      project_id: 'proj-001',
      task_type: 'dev'
    });

    // Should return deduplicated: true
    expect(result.deduplicated).toBe(true);
    expect(result.success).toBe(true);
    expect(result.task.id).toBe('existing-queued-001');
  });

  it('dedup detects task with same title in in_progress status', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'existing-active-001',
        title: 'Active Task',
        status: 'in_progress',
        goal_id: 'kr-002',
        project_id: 'proj-002'
      }]
    });

    const result = await createTask({
      title: 'Active Task',
      goal_id: 'kr-002',
      project_id: 'proj-002',
      task_type: 'dev'
    });

    expect(result.deduplicated).toBe(true);
    expect(result.task.status).toBe('in_progress');
  });

  it('dedup allows new task when no existing task found', async () => {
    // No existing task - should create new one
    pool.query.mockResolvedValueOnce({ rows: [] });

    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'new-task-001',
        title: 'New Task',
        status: 'queued',
        goal_id: 'kr-003',
        project_id: 'proj-003'
      }]
    });

    const result = await createTask({
      title: 'New Task',
      goal_id: 'kr-003',
      project_id: 'proj-003',
      task_type: 'dev'
    });

    // Should create new task (not deduplicated)
    expect(result.deduplicated).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.task.status).toBe('queued');
  });

  it('dedup distinguishes different goal_id - allows new task', async () => {
    // Different goal_id - should NOT deduplicate (empty result from dedup query)
    pool.query.mockResolvedValueOnce({ rows: [] });

    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'new-task-002',
        title: 'Same Title',
        status: 'queued',
        goal_id: 'different-kr',
        project_id: 'proj-001'
      }]
    });

    const result = await createTask({
      title: 'Same Title',
      goal_id: 'different-kr', // Different goal_id
      project_id: 'proj-001',
      task_type: 'dev'
    });

    // Should create new task because goal_id is different
    expect(result.deduplicated).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('dedup distinguishes different project_id - allows new task', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'new-task-003',
        title: 'Task Title',
        status: 'queued',
        goal_id: 'kr-005',
        project_id: 'different-proj'
      }]
    });

    const result = await createTask({
      title: 'Task Title',
      goal_id: 'kr-005',
      project_id: 'different-proj', // Different project_id
      task_type: 'dev'
    });

    expect(result.deduplicated).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('dedup behavior consistent: queued blocks like in_progress', async () => {
    // Test that queued blocks new task creation (same as in_progress)
    const queuedTask = {
      rows: [{
        id: 'queued-001',
        title: 'Blocking Task',
        status: 'queued',
        goal_id: 'kr-005',
        project_id: 'proj-005'
      }]
    };

    const activeTask = {
      rows: [{
        id: 'active-001',
        title: 'Blocking Task',
        status: 'in_progress',
        goal_id: 'kr-005',
        project_id: 'proj-005'
      }]
    };

    // Test queued blocking
    pool.query.mockResolvedValueOnce(queuedTask);
    const queuedResult = await createTask({
      title: 'Blocking Task',
      goal_id: 'kr-005',
      project_id: 'proj-005',
      task_type: 'dev'
    });
    expect(queuedResult.deduplicated).toBe(true);
    expect(queuedResult.task.status).toBe('queued');

    // Test in_progress blocking
    pool.query.mockResolvedValueOnce(activeTask);
    const activeResult = await createTask({
      title: 'Blocking Task',
      goal_id: 'kr-005',
      project_id: 'proj-005',
      task_type: 'dev'
    });
    expect(activeResult.deduplicated).toBe(true);
    expect(activeResult.task.status).toBe('in_progress');

    // Both queued and in_progress should block
    expect(queuedResult.deduplicated).toBe(activeResult.deduplicated);
  });

  it('dedup returns existing task details when deduplicated', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'existing-task-999',
        title: 'Existing Task',
        status: 'queued',
        goal_id: 'kr-999',
        project_id: 'proj-999',
        priority: 'P0',
        description: 'Original description'
      }]
    });

    const result = await createTask({
      title: 'Existing Task',
      goal_id: 'kr-999',
      project_id: 'proj-999',
      task_type: 'dev',
      description: 'New description' // This should be ignored
    });

    expect(result.deduplicated).toBe(true);
    expect(result.task.id).toBe('existing-task-999');
    expect(result.task.description).toBe('Original description'); // Original preserved
  });
});
