/**
 * Tests for P1 FIX #2: Failure classification storage
 *
 * Before fix: retry_strategy computed but never stored or used
 * After fix: handleTaskFailure() stores classification to payload.failure_classification
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pool from '../db.js';
import { handleTaskFailure, FAILURE_CLASS } from '../quarantine.js';

describe('quarantine-classification (P1 Fix #2)', () => {
  let testTaskId;

  beforeEach(async () => {
    // Create test task with error_details
    const result = await pool.query(`
      INSERT INTO tasks (title, status, payload)
      VALUES ('test-classification', 'failed', $1::jsonb)
      RETURNING id
    `, [JSON.stringify({ error_details: 'ECONNREFUSED: Connection refused' })]);
    testTaskId = result.rows[0].id;
  });

  afterEach(async () => {
    await pool.query('DELETE FROM tasks WHERE title LIKE $1', ['test-classification%']);
  });

  it('should store failure_classification when handling task failure', async () => {
    const result = await handleTaskFailure(testTaskId);

    expect(result.quarantined).toBe(false);
    expect(result.classification).toBeDefined();
    expect(result.classification.class).toBe(FAILURE_CLASS.NETWORK);

    // Check database
    const task = await pool.query('SELECT payload FROM tasks WHERE id = $1', [testTaskId]);
    const payload = task.rows[0].payload;

    expect(payload.failure_classification).toBeDefined();
    expect(payload.failure_classification.class).toBe(FAILURE_CLASS.NETWORK);
    expect(payload.failure_classification.retry_strategy).toBeDefined();
  });

  it('should classify BILLING_CAP errors correctly', async () => {
    // Update task with billing cap error
    await pool.query(`
      UPDATE tasks
      SET payload = $1::jsonb
      WHERE id = $2
    `, [JSON.stringify({ error_details: 'Spending cap reached' }), testTaskId]);

    const result = await handleTaskFailure(testTaskId);

    expect(result.classification.class).toBe(FAILURE_CLASS.BILLING_CAP);
    expect(result.classification.retry_strategy.billing_pause).toBe(true);
    expect(result.classification.retry_strategy.next_run_at).toBeDefined();
  });

  it('should classify RATE_LIMIT errors correctly', async () => {
    await pool.query(`
      UPDATE tasks
      SET payload = $1::jsonb
      WHERE id = $2
    `, [JSON.stringify({ error_details: '429 Too many requests' }), testTaskId]);

    const result = await handleTaskFailure(testTaskId);

    expect(result.classification.class).toBe(FAILURE_CLASS.RATE_LIMIT);
    expect(result.classification.retry_strategy.should_retry).toBe(true);
    expect(result.classification.retry_strategy.next_run_at).toBeDefined();
  });

  it('should increment failure_count on each handleTaskFailure call', async () => {
    await handleTaskFailure(testTaskId);
    const task1 = await pool.query('SELECT payload FROM tasks WHERE id = $1', [testTaskId]);
    expect(task1.rows[0].payload.failure_count).toBe(1);

    await handleTaskFailure(testTaskId);
    const task2 = await pool.query('SELECT payload FROM tasks WHERE id = $1', [testTaskId]);
    expect(task2.rows[0].payload.failure_count).toBe(2);
  });
});
