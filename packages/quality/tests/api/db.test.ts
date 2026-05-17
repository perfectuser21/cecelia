import { describe, it, expect } from 'vitest';
import pool from '../../api/src/task-system/db.js';

describe('PostgreSQL Database Connection', () => {
  it('should connect to PostgreSQL', async () => {
    const result = await pool.query('SELECT NOW()');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toHaveProperty('now');
  });

  it('should query database version', async () => {
    const result = await pool.query('SELECT version()');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].version).toContain('PostgreSQL');
  });

  it('should list existing tables', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    expect(result.rows.length).toBeGreaterThan(0);

    const tableNames = result.rows.map(row => row.table_name);
    expect(tableNames).toContain('projects');
    expect(tableNames).toContain('goals');
    expect(tableNames).toContain('tasks');
    expect(tableNames).toContain('task_links');
  });

  it('should execute transactions', async () => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT 1 as num');
      await client.query('COMMIT');

      expect(res.rows[0].num).toBe(1);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  it('should handle concurrent connections', async () => {
    const queries = Array(10).fill(null).map(() =>
      pool.query('SELECT $1::int as value', [Math.floor(Math.random() * 100)])
    );

    const results = await Promise.all(queries);
    expect(results).toHaveLength(10);
    results.forEach(result => {
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].value).toBeGreaterThanOrEqual(0);
      expect(result.rows[0].value).toBeLessThan(100);
    });
  });

  it('should handle query errors gracefully', async () => {
    await expect(pool.query('SELECT * FROM nonexistent_table')).rejects.toThrow();
  });
});
