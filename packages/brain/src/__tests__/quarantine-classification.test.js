/**
 * Tests for P1 FIX #2: Failure classification storage
 *
 * Before fix: retry_strategy computed but never stored or used
 * After fix: handleTaskFailure() stores classification to payload.failure_classification
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
let pool;
let handleTaskFailure, FAILURE_CLASS;

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../db.js')).default;
  ({ handleTaskFailure, FAILURE_CLASS } = await import('../quarantine.js'));
});

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

  it('should block task on BILLING_CAP errors (not quarantine)', async () => {
    // Update task with billing cap error
    await pool.query(`
      UPDATE tasks
      SET payload = $1::jsonb
      WHERE id = $2
    `, [JSON.stringify({ error_details: 'Spending cap reached' }), testTaskId]);

    const result = await handleTaskFailure(testTaskId);

    // BILLING_CAP → blockTask (not quarantine), returns { blocked, reason, blocked_until }
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('billing_cap');
    expect(result.blocked_until).toBeDefined();
  });

  it('should block task on RATE_LIMIT errors for 5min (not quarantine)', async () => {
    await pool.query(`
      UPDATE tasks
      SET payload = $1::jsonb
      WHERE id = $2
    `, [JSON.stringify({ error_details: '429 Too many requests' }), testTaskId]);

    const result = await handleTaskFailure(testTaskId);

    // RATE_LIMIT → blockTask (not quarantine), returns { blocked, reason, blocked_until }
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('rate_limit');
    expect(result.blocked_until).toBeDefined();
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
