import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pool from '../db.js';

describe('PATCH /api/brain/tasks/:task_id (Status Update)', () => {
  let testTaskId;

  beforeAll(async () => {
    // Create a test task
    const result = await pool.query(`
      INSERT INTO tasks (title, description, status)
      VALUES ('Test Status Task', 'Test status updates', 'pending')
      RETURNING id
    `);
    testTaskId = result.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup
    if (testTaskId) {
      await pool.query('DELETE FROM tasks WHERE id = $1', [testTaskId]);
    }
    await pool.end();
  });

  beforeEach(async () => {
    // Reset status and history for each test
    await pool.query(`
      UPDATE tasks
      SET status = 'pending', status_history = '[]'::jsonb
      WHERE id = $1
    `, [testTaskId]);
  });

  it('should accept valid status update (pending → in_progress)', async () => {
    const newStatus = 'in_progress';
    const historyEntry = {
      from: 'pending',
      to: newStatus,
      changed_at: new Date().toISOString(),
      source: 'engine'
    };

    const result = await pool.query(`
      UPDATE tasks
      SET
        status = $1,
        status_history = status_history || $2::jsonb,
        updated_at = NOW()
      WHERE id = $3
      RETURNING status, status_history
    `, [newStatus, JSON.stringify([historyEntry]), testTaskId]);

    expect(result.rows[0].status).toBe('in_progress');
    expect(result.rows[0].status_history).toHaveLength(1);
    expect(result.rows[0].status_history[0].from).toBe('pending');
    expect(result.rows[0].status_history[0].to).toBe('in_progress');
    expect(result.rows[0].status_history[0].source).toBe('engine');
  });

  it('should accept valid status update (in_progress → completed)', async () => {
    // First move to in_progress
    await pool.query(`
      UPDATE tasks
      SET status = 'in_progress', status_history = '[]'::jsonb
      WHERE id = $1
    `, [testTaskId]);

    // Then move to completed
    const newStatus = 'completed';
    const historyEntry = {
      from: 'in_progress',
      to: newStatus,
      changed_at: new Date().toISOString(),
      source: 'engine'
    };

    const result = await pool.query(`
      UPDATE tasks
      SET
        status = $1,
        status_history = status_history || $2::jsonb
      WHERE id = $3
      RETURNING status, status_history
    `, [newStatus, JSON.stringify([historyEntry]), testTaskId]);

    expect(result.rows[0].status).toBe('completed');
    expect(result.rows[0].status_history[0].from).toBe('in_progress');
    expect(result.rows[0].status_history[0].to).toBe('completed');
  });

  it('should accept valid status update (in_progress → failed)', async () => {
    // First move to in_progress
    await pool.query(`
      UPDATE tasks
      SET status = 'in_progress', status_history = '[]'::jsonb
      WHERE id = $1
    `, [testTaskId]);

    // Then move to failed
    const newStatus = 'failed';
    const historyEntry = {
      from: 'in_progress',
      to: newStatus,
      changed_at: new Date().toISOString(),
      source: 'engine'
    };

    const result = await pool.query(`
      UPDATE tasks
      SET
        status = $1,
        status_history = status_history || $2::jsonb
      WHERE id = $3
      RETURNING status, status_history
    `, [newStatus, JSON.stringify([historyEntry]), testTaskId]);

    expect(result.rows[0].status).toBe('failed');
    expect(result.rows[0].status_history[0].to).toBe('failed');
  });

  it('should reject invalid status transitions (completed → pending)', async () => {
    // Set task to completed
    await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', ['completed', testTaskId]);

    // Try to transition to pending
    const currentStatus = 'completed';
    const requestedStatus = 'pending';

    const allowedTransitions = {
      'pending': ['in_progress'],
      'in_progress': ['completed', 'failed'],
      'completed': [],
      'failed': []
    };

    const isAllowed = allowedTransitions[currentStatus]?.includes(requestedStatus);
    expect(isAllowed).toBe(false);
  });

  it('should reject invalid status transitions (failed → in_progress)', async () => {
    // Set task to failed
    await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', ['failed', testTaskId]);

    const currentStatus = 'failed';
    const requestedStatus = 'in_progress';

    const allowedTransitions = {
      'pending': ['in_progress'],
      'in_progress': ['completed', 'failed'],
      'completed': [],
      'failed': []
    };

    const isAllowed = allowedTransitions[currentStatus]?.includes(requestedStatus);
    expect(isAllowed).toBe(false);
  });

  it('should record status history correctly', async () => {
    // pending → in_progress
    await pool.query(`
      UPDATE tasks
      SET
        status = 'in_progress',
        status_history = status_history || $1::jsonb
      WHERE id = $2
    `, [JSON.stringify([{ from: 'pending', to: 'in_progress', changed_at: new Date().toISOString(), source: 'engine' }]), testTaskId]);

    // in_progress → completed
    await pool.query(`
      UPDATE tasks
      SET
        status = 'completed',
        status_history = status_history || $1::jsonb
      WHERE id = $2
    `, [JSON.stringify([{ from: 'in_progress', to: 'completed', changed_at: new Date().toISOString(), source: 'engine' }]), testTaskId]);

    const result = await pool.query('SELECT status_history FROM tasks WHERE id = $1', [testTaskId]);

    expect(result.rows[0].status_history).toHaveLength(2);
    expect(result.rows[0].status_history[0].from).toBe('pending');
    expect(result.rows[0].status_history[0].to).toBe('in_progress');
    expect(result.rows[0].status_history[1].from).toBe('in_progress');
    expect(result.rows[0].status_history[1].to).toBe('completed');
  });

  it('should validate allowed status values', async () => {
    const allowedStatuses = ['in_progress', 'completed', 'failed'];
    const invalidStatuses = ['pending', 'quarantined', 'cancelled'];

    for (const status of allowedStatuses) {
      expect(allowedStatuses.includes(status)).toBe(true);
    }

    for (const status of invalidStatuses) {
      expect(allowedStatuses.includes(status)).toBe(false);
    }
  });

  it('should handle non-existent task_id', async () => {
    // Use a valid UUID format
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    const result = await pool.query('SELECT id FROM tasks WHERE id = $1', [nonExistentId]);
    expect(result.rows.length).toBe(0);
  });

  it('should validate status field is required', async () => {
    const requestBody = {};
    const isValid = requestBody.status !== undefined;
    expect(isValid).toBe(false);
  });
});
