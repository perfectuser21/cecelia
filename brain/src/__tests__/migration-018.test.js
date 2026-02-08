import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../db.js';

describe('Migration 018: Feedback and Status History', () => {
  beforeAll(async () => {
    // Migration should have been applied during server startup
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should have feedback column in tasks table', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'feedback'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('jsonb');
    expect(result.rows[0].column_default).toContain("'[]'::jsonb");
  });

  it('should have status_history column in tasks table', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'status_history'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('jsonb');
    expect(result.rows[0].column_default).toContain("'[]'::jsonb");
  });

  it('should have feedback_count column in tasks table', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'feedback_count'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('integer');
    expect(result.rows[0].column_default).toBe('0');
  });

  it('should have GIN index on feedback column', async () => {
    const result = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'tasks' AND indexname = 'idx_tasks_feedback'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].indexdef).toContain('gin');
  });

  it('should have GIN index on status_history column', async () => {
    const result = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'tasks' AND indexname = 'idx_tasks_status_history'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].indexdef).toContain('gin');
  });

  it('should have index on feedback_count column', async () => {
    const result = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'tasks' AND indexname = 'idx_tasks_feedback_count'
    `);

    expect(result.rows.length).toBe(1);
  });

  it('should initialize new tasks with empty arrays', async () => {
    // Create a test task
    const insertResult = await pool.query(`
      INSERT INTO tasks (title, description, status)
      VALUES ('Test Task', 'Test Description', 'pending')
      RETURNING id, feedback, status_history, feedback_count
    `);

    const task = insertResult.rows[0];

    expect(task.feedback).toEqual([]);
    expect(task.status_history).toEqual([]);
    expect(task.feedback_count).toBe(0);

    // Cleanup
    await pool.query('DELETE FROM tasks WHERE id = $1', [task.id]);
  });
});
