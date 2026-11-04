/**
 * Tests for P1 FIX #2: Failure classification storage
 *
 * Before fix: retry_strategy computed but never stored or used
 * After fix: handleTaskFailure() stores classification to payload.failure_classification
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { pool, setupScratch, closeScratch } from './helpers/debt-01-scratch.js';

vi.mock('../db.js', async () => ({ default: (await import('./helpers/debt-01-scratch.js')).pool }));
vi.mock('child_process', () => ({ execFile: vi.fn((_cmd, _args, _opts, cb) => cb(null, '', '')) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../learning.js', () => ({ upsertLearning: vi.fn(() => { throw new Error('本合同禁止模型学习调用'); }) }));
vi.mock('../quarantine-active-signal.js', () => ({ hasActiveSignal: vi.fn().mockResolvedValue({ active: false }) }));
vi.mock('../consciousness-guard.js', () => ({ isConsciousnessEnabled: () => false }));
vi.mock('../executor.js', () => ({ setBillingPause: vi.fn() }));
let handleTaskFailure, FAILURE_CLASS;

beforeAll(async () => {
  await setupScratch();
  ({ handleTaskFailure, FAILURE_CLASS } = await import('../quarantine.js'));
});

afterAll(closeScratch);

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
    if (testTaskId) await pool.query('DELETE FROM tasks WHERE id = $1', [testTaskId]);
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
    expect(payload.failure_classification).toMatchObject({ class: FAILURE_CLASS.NETWORK });
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
    const { rows: [stored] } = await pool.query('SELECT status, blocked_reason, blocked_until FROM tasks WHERE id = $1', [testTaskId]);
    expect(stored.status).toBe('blocked');
    expect(stored.blocked_reason).toBe(result.reason);
    expect(stored.blocked_until.toISOString()).toBe(result.blocked_until);
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
    const { rows: [stored] } = await pool.query('SELECT status, blocked_reason, blocked_until FROM tasks WHERE id = $1', [testTaskId]);
    expect(stored.status).toBe('blocked');
    expect(stored.blocked_reason).toBe(result.reason);
    expect(stored.blocked_until.toISOString()).toBe(result.blocked_until);
  });

  it('should increment failure_count on each handleTaskFailure call', async () => {
    await handleTaskFailure(testTaskId);
    const task1 = await pool.query('SELECT payload FROM tasks WHERE id = $1', [testTaskId]);
    expect(task1.rows[0].payload.failure_count).toBe(1);

    await handleTaskFailure(testTaskId);
    const task2 = await pool.query('SELECT payload FROM tasks WHERE id = $1', [testTaskId]);
    expect(task2.rows[0].payload.failure_count).toBe(2);
  });
  it('missing task must not fabricate a classification or insert a row', async () => {
    const missingId = '00000000-0000-0000-0000-000000000001';
    const result = await handleTaskFailure(missingId);
    expect(result).toEqual({ quarantined: false, error: 'Task not found' });
    expect((await pool.query('SELECT id FROM tasks WHERE id = $1', [missingId])).rows).toEqual([]);
  });

});
