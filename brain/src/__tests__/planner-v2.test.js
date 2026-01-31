import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn() }));

import pool from '../db.js';
import { generateNextTask, autoGenerateTask, generateTaskTitle } from '../planner.js';

describe('Planner V2 - generateNextTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing queued task (V1 behavior)', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 't1', title: 'Existing task', priority: 'P0', project_id: 'p1', goal_id: 'kr1' }]
    });

    const kr = { id: 'kr1', title: 'KR 1', progress: 50 };
    const project = { id: 'p1', name: 'Project 1', repo_path: '/path' };
    const task = await generateNextTask(kr, project, {});

    expect(task.id).toBe('t1');
    expect(task.title).toBe('Existing task');
  });

  it('auto-generates when queue is empty and there are failed tasks to retry', async () => {
    // No queued tasks
    pool.query.mockResolvedValueOnce({ rows: [] });
    // Completed titles
    pool.query.mockResolvedValueOnce({ rows: [] });
    // Failed tasks
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'f1', title: 'Failed task', description: 'desc', priority: 'P1', payload: {} }]
    });
    // Insert retry task
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 't-retry', title: '[Retry] Failed task', priority: 'P1', project_id: 'p1', goal_id: 'kr1' }]
    });

    const kr = { id: 'kr1', title: 'KR 1', progress: 50 };
    const project = { id: 'p1', name: 'Project 1', repo_path: '/path' };
    const task = await generateNextTask(kr, project, {});

    expect(task.title).toBe('[Retry] Failed task');
    expect(pool.query).toHaveBeenCalledTimes(4);
  });

  it('auto-generates new task when no failed tasks and queue empty', async () => {
    // No queued tasks
    pool.query.mockResolvedValueOnce({ rows: [] });
    // Completed titles
    pool.query.mockResolvedValueOnce({ rows: [] });
    // No failed tasks
    pool.query.mockResolvedValueOnce({ rows: [] });
    // Insert new task
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 't-new', title: 'Advance "KR 1" for Project 1', priority: 'P0', project_id: 'p1', goal_id: 'kr1' }]
    });

    const kr = { id: 'kr1', title: 'KR 1', progress: 30 };
    const project = { id: 'p1', name: 'Project 1', repo_path: '/path' };
    const task = await generateNextTask(kr, project, {});

    expect(task.title).toContain('Advance');
    expect(task.priority).toBe('P0');
  });

  it('returns null when KR is already complete', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // no queued
    pool.query.mockResolvedValueOnce({ rows: [] }); // completed
    pool.query.mockResolvedValueOnce({ rows: [] }); // failed

    const kr = { id: 'kr1', title: 'KR Done', progress: 100 };
    const project = { id: 'p1', name: 'Project 1', repo_path: '/path' };
    const task = await generateNextTask(kr, project, {});

    expect(task).toBeNull();
  });

  it('dry_run does not write to DB', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // no queued
    pool.query.mockResolvedValueOnce({ rows: [] }); // completed
    pool.query.mockResolvedValueOnce({ rows: [] }); // failed

    const kr = { id: 'kr1', title: 'KR 1', progress: 50 };
    const project = { id: 'p1', name: 'Project 1', repo_path: '/path' };
    const task = await generateNextTask(kr, project, {}, { dryRun: true });

    expect(task._generated).toBe(true);
    expect(task._strategy).toBe('auto');
    expect(task.id).toBeNull();
    // Should not have called INSERT
    expect(pool.query).toHaveBeenCalledTimes(3); // only SELECTs, no INSERT
  });

  it('skips retry when retry_count >= 2 and uses dry_run', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // no queued
    pool.query.mockResolvedValueOnce({ rows: [] }); // completed
    // Failed task with retry_count = 2
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'f1', title: 'Failed', description: '', priority: 'P1', payload: { retry_count: 2 } }]
    });

    const kr = { id: 'kr1', title: 'KR 1', progress: 60 };
    const project = { id: 'p1', name: 'Proj', repo_path: '/path' };
    const task = await generateNextTask(kr, project, {}, { dryRun: true });

    expect(task._generated).toBe(true);
    expect(task._strategy).toBe('auto');
    expect(task.title).toContain('Advance');
  });
});

describe('generateTaskTitle', () => {
  it('generates title from KR and project', () => {
    const title = generateTaskTitle(
      { title: 'Ship MVP' },
      { name: 'cecelia' },
      [],
      50
    );
    expect(title).toBe('Advance "Ship MVP" for cecelia');
  });

  it('adds iteration number for duplicate titles', () => {
    const title = generateTaskTitle(
      { title: 'Ship MVP' },
      { name: 'cecelia' },
      ['Advance "Ship MVP" for cecelia'],
      50
    );
    expect(title).toContain('iteration');
  });
});
