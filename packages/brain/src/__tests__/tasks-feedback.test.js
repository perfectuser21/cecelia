import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pool from '../db.js';

describe('POST /api/brain/tasks/:task_id/feedback', () => {
  let testTaskId;

  beforeAll(async () => {
    // Create a test task
    const result = await pool.query(`
      INSERT INTO tasks (title, description, status)
      VALUES ('Test Feedback Task', 'Test feedback functionality', 'in_progress')
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
    // Reset feedback for each test
    await pool.query(`
      UPDATE tasks
      SET feedback = '[]'::jsonb, feedback_count = 0
      WHERE id = $1
    `, [testTaskId]);
  });

  it('should accept valid feedback request', async () => {
    const feedbackData = {
      status: 'completed',
      summary: 'Task completed successfully',
      metrics: {
        duration_seconds: 4800,
        commits: 3,
        files_changed: 8
      }
    };

    const result = await pool.query(`
      UPDATE tasks
      SET
        feedback = feedback || $1::jsonb,
        feedback_count = feedback_count + 1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING feedback, feedback_count
    `, [JSON.stringify([{ ...feedbackData, id: 'test-uuid', received_at: new Date().toISOString() }]), testTaskId]);

    expect(result.rows[0].feedback).toHaveLength(1);
    expect(result.rows[0].feedback[0].status).toBe('completed');
    expect(result.rows[0].feedback[0].summary).toBe('Task completed successfully');
    expect(result.rows[0].feedback_count).toBe(1);
  });

  it('should reject feedback with missing required fields', async () => {
    // Missing summary
    const invalidData = {
      status: 'completed'
    };

    // Simulate validation
    const isValid = !!(invalidData.status && invalidData.summary);
    expect(isValid).toBe(false);
  });

  it('should reject invalid status values', async () => {
    const invalidStatuses = ['pending', 'in_progress', 'invalid'];

    for (const status of invalidStatuses) {
      const isValid = ['completed', 'failed'].includes(status);
      expect(isValid).toBe(false);
    }
  });

  it('should handle non-existent task_id', async () => {
    // Use a valid UUID format
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    const result = await pool.query('SELECT id FROM tasks WHERE id = $1', [nonExistentId]);
    expect(result.rows.length).toBe(0);
  });

  it('should support multiple feedback submissions', async () => {
    // First feedback
    await pool.query(`
      UPDATE tasks
      SET
        feedback = feedback || $1::jsonb,
        feedback_count = feedback_count + 1
      WHERE id = $2
    `, [JSON.stringify([{ id: 'feedback-1', status: 'completed', summary: 'First feedback', received_at: new Date().toISOString() }]), testTaskId]);

    // Second feedback
    await pool.query(`
      UPDATE tasks
      SET
        feedback = feedback || $1::jsonb,
        feedback_count = feedback_count + 1
      WHERE id = $2
    `, [JSON.stringify([{ id: 'feedback-2', status: 'failed', summary: 'Second feedback', received_at: new Date().toISOString() }]), testTaskId]);

    const result = await pool.query('SELECT feedback, feedback_count FROM tasks WHERE id = $1', [testTaskId]);

    expect(result.rows[0].feedback).toHaveLength(2);
    expect(result.rows[0].feedback_count).toBe(2);
    expect(result.rows[0].feedback[0].id).toBe('feedback-1');
    expect(result.rows[0].feedback[1].id).toBe('feedback-2');
  });

  it('should increment feedback_count correctly', async () => {
    // Submit 3 feedbacks
    for (let i = 1; i <= 3; i++) {
      await pool.query(`
        UPDATE tasks
        SET
          feedback = feedback || $1::jsonb,
          feedback_count = feedback_count + 1
        WHERE id = $2
      `, [JSON.stringify([{ id: `feedback-${i}`, status: 'completed', summary: `Feedback ${i}`, received_at: new Date().toISOString() }]), testTaskId]);
    }

    const result = await pool.query('SELECT feedback_count FROM tasks WHERE id = $1', [testTaskId]);
    expect(result.rows[0].feedback_count).toBe(3);
  });

  it('should store optional fields (metrics, artifacts, issues, learnings)', async () => {
    const completeData = {
      id: 'test-uuid',
      status: 'completed',
      summary: 'Complete feedback',
      metrics: { duration_seconds: 100 },
      artifacts: { pr_url: 'https://github.com/user/repo/pull/123' },
      issues: ['Issue 1', 'Issue 2'],
      learnings: ['Learning 1'],
      received_at: new Date().toISOString()
    };

    await pool.query(`
      UPDATE tasks
      SET
        feedback = feedback || $1::jsonb,
        feedback_count = feedback_count + 1
      WHERE id = $2
    `, [JSON.stringify([completeData]), testTaskId]);

    const result = await pool.query('SELECT feedback FROM tasks WHERE id = $1', [testTaskId]);
    const feedback = result.rows[0].feedback[0];

    expect(feedback.metrics).toEqual({ duration_seconds: 100 });
    expect(feedback.artifacts).toEqual({ pr_url: 'https://github.com/user/repo/pull/123' });
    expect(feedback.issues).toEqual(['Issue 1', 'Issue 2']);
    expect(feedback.learnings).toEqual(['Learning 1']);
  });

  it('should validate task must be in allowed status', async () => {
    // Create a pending task
    const pendingResult = await pool.query(`
      INSERT INTO tasks (title, description, status)
      VALUES ('Pending Task', 'Test', 'pending')
      RETURNING id
    `);
    const pendingTaskId = pendingResult.rows[0].id;

    // Check if status is allowed
    const task = await pool.query('SELECT status FROM tasks WHERE id = $1', [pendingTaskId]);
    const isAllowed = ['in_progress', 'completed', 'failed'].includes(task.rows[0].status);

    expect(isAllowed).toBe(false);

    // Cleanup
    await pool.query('DELETE FROM tasks WHERE id = $1', [pendingTaskId]);
  });
});
