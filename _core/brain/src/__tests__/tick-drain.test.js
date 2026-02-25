/**
 * Tick Drain Mode Tests
 *
 * Tests graceful drain: stop dispatching new tasks while letting
 * in_progress tasks complete naturally.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

let testGoalIds = [];
let testProjectIds = [];
let testTaskIds = [];

// Import drain functions from tick.js
let drainTick, getDrainStatus, cancelDrain, _getDrainState, _resetDrainState;

describe('Tick Drain Mode', () => {
  beforeAll(async () => {
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);

    // Dynamic import to get drain functions
    const tickModule = await import('../tick.js');
    drainTick = tickModule.drainTick;
    getDrainStatus = tickModule.getDrainStatus;
    cancelDrain = tickModule.cancelDrain;
    _getDrainState = tickModule._getDrainState;
    _resetDrainState = tickModule._resetDrainState;
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    // Reset drain state between tests
    _resetDrainState();

    if (testTaskIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [testTaskIds]);
      testTaskIds = [];
    }
    if (testProjectIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE project_id = ANY($1)', [testProjectIds]).catch(() => {});
      await pool.query('DELETE FROM projects WHERE id = ANY($1)', [testProjectIds]);
      testProjectIds = [];
    }
    if (testGoalIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE goal_id = ANY($1)', [testGoalIds]).catch(() => {});
      await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testGoalIds]);
      testGoalIds = [];
    }
  });

  it('should activate drain mode', async () => {
    const result = await drainTick();
    expect(result.success).toBe(true);
    expect(result.draining).toBe(true);
    expect(result.drain_started_at).toBeTruthy();

    const state = _getDrainState();
    expect(state.draining).toBe(true);
  });

  it('should return already_draining if drain called twice', async () => {
    // First call activates drain
    await drainTick();
    expect(_getDrainState().draining).toBe(true);

    // Second call returns already_draining
    const result = await drainTick();
    expect(result.success).toBe(true);
    expect(result.already_draining).toBe(true);
    expect(result.draining).toBe(true);
  });

  it('should report in_progress tasks during drain', async () => {
    // Create an in_progress task
    const goalResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Drain test goal', 'kr', 'P0', 'pending', 0) RETURNING id"
    );
    testGoalIds.push(goalResult.rows[0].id);

    const task = await pool.query(
      "INSERT INTO tasks (title, status, goal_id, priority, started_at) VALUES ('Running task', 'in_progress', $1, 'P1', NOW()) RETURNING *",
      [goalResult.rows[0].id]
    );
    testTaskIds.push(task.rows[0].id);

    // Activate drain
    const drainResult = await drainTick();
    expect(drainResult.draining).toBe(true);
    expect(drainResult.remaining).toBeGreaterThanOrEqual(1);

    // Check drain status
    const status = await getDrainStatus();
    expect(status.draining).toBe(true);
    expect(status.remaining).toBeGreaterThanOrEqual(1);
    expect(status.in_progress_tasks.length).toBeGreaterThanOrEqual(1);

    const found = status.in_progress_tasks.find(t => t.id === task.rows[0].id);
    expect(found).toBeTruthy();
    expect(found.title).toBe('Running task');
  });

  it('should cancel drain and resume normal state', async () => {
    await drainTick();
    expect(_getDrainState().draining).toBe(true);

    const result = cancelDrain();
    expect(result.success).toBe(true);
    expect(result.was_draining).toBe(true);
    expect(_getDrainState().draining).toBe(false);
  });

  it('should return was_draining=false if cancel when not draining', () => {
    const result = cancelDrain();
    expect(result.success).toBe(true);
    expect(result.was_draining).toBe(false);
  });

  it('should auto-complete drain when no in_progress tasks remain', async () => {
    // Clean up any lingering in_progress tasks from other tests
    await pool.query("UPDATE tasks SET status = 'completed' WHERE status = 'in_progress'");

    // Activate drain (no in_progress tasks exist)
    const drainResult = await drainTick();
    expect(drainResult.draining).toBe(true);
    expect(drainResult.remaining).toBe(0);

    // Now getDrainStatus should auto-complete
    const status = await getDrainStatus();
    expect(status.draining).toBe(false);
    expect(status.drain_completed).toBe(true);
    expect(status.remaining).toBe(0);

    // Drain state should be reset
    expect(_getDrainState().draining).toBe(false);
  });

  it('should not report draining when drain is not active', async () => {
    const status = await getDrainStatus();
    expect(status.draining).toBe(false);
    expect(status.in_progress_tasks).toEqual([]);
    expect(status.remaining).toBe(0);
  });
});
