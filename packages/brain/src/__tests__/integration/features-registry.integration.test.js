import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const { Pool } = pg;
let pool;
const TEST_IDS = ['test-feat-001', 'test-feat-002'];

beforeAll(async () => {
  pool = new Pool(DB_DEFAULTS);
  await pool.query(`DELETE FROM features WHERE id = ANY($1)`, [TEST_IDS]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM features WHERE id = ANY($1)`, [TEST_IDS]);
  await pool.end();
});

describe('features table', () => {
  it('inserts a feature and reads it back', async () => {
    const { rows } = await pool.query(
      `INSERT INTO features (id, name, priority, status, smoke_status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      ['test-feat-001', 'Test Feature 001', 'P0', 'active', 'unknown']
    );
    expect(rows[0].id).toBe('test-feat-001');
    expect(rows[0].smoke_status).toBe('unknown');
    expect(rows[0].created_at).not.toBeNull();
  });

  it('filters by priority', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM features WHERE id = $1 AND priority = $2`,
      ['test-feat-001', 'P0']
    );
    expect(rows).toHaveLength(1);
  });

  it('updates smoke_status without changing other fields', async () => {
    await pool.query(
      `UPDATE features SET smoke_status = $1, smoke_last_run = NOW(), updated_at = NOW()
       WHERE id = $2`,
      ['passing', 'test-feat-001']
    );
    const { rows } = await pool.query(`SELECT * FROM features WHERE id = $1`, ['test-feat-001']);
    expect(rows[0].smoke_status).toBe('passing');
    expect(rows[0].name).toBe('Test Feature 001');
    expect(rows[0].smoke_last_run).not.toBeNull();
  });

  it('seed upsert preserves existing smoke_status', async () => {
    await pool.query(
      `INSERT INTO features (id, name, priority, status, smoke_status)
       VALUES ($1, $2, $3, $4, $5)`,
      ['test-feat-002', 'Original Name', 'P1', 'active', 'passing']
    );
    // Simulate seed: upsert 更新 name 但不动 smoke_status
    await pool.query(
      `INSERT INTO features (id, name, priority, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         priority = EXCLUDED.priority,
         status = EXCLUDED.status,
         updated_at = NOW()`,
      ['test-feat-002', 'Updated Name', 'P1', 'active']
    );
    const { rows } = await pool.query(`SELECT * FROM features WHERE id = $1`, ['test-feat-002']);
    expect(rows[0].name).toBe('Updated Name');
    expect(rows[0].smoke_status).toBe('passing');
  });
});
