/**
 * Migration 333 Tests
 *
 * areas 表去重 + 2个active Objective挂area + ZenithJoy线 KR1/KR2 挂 metadata.target_abilities
 */
import { describe, it, expect, beforeAll } from 'vitest';
let pool;

beforeAll(async () => {
  pool = (await import('../db.js')).default;
});

describe('Migration 333 - OKR areas dedup + KR ability link', () => {
  beforeAll(async () => {
    const result = await pool.query(
      "SELECT version FROM schema_version WHERE version = '333'"
    );
    if (result.rows.length === 0) {
      throw new Error('Migration 333 not applied - run migrations first');
    }
  });

  it('areas table has no duplicate names', async () => {
    const { rows } = await pool.query(
      'SELECT name, COUNT(*) AS cnt FROM areas GROUP BY name HAVING COUNT(*) > 1'
    );
    expect(rows).toEqual([]);
  });

  it('active objectives all have a non-null area_id', async () => {
    const { rows } = await pool.query(
      "SELECT id, title FROM objectives WHERE status = 'active' AND area_id IS NULL"
    );
    expect(rows).toEqual([]);
  });

  it('KR1/KR2 (if present) carry non-empty metadata.target_abilities', async () => {
    const { rows } = await pool.query(
      `SELECT id, metadata FROM key_results
       WHERE id IN ('d86f67df-04c8-47dc-922f-c0e4fd0645bb', 'f19118cd-c4fe-478d-abf5-00bde5566a05')`
    );
    for (const row of rows) {
      const targetAbilities = row.metadata?.target_abilities;
      expect(Array.isArray(targetAbilities)).toBe(true);
      expect(targetAbilities.length).toBeGreaterThan(0);
    }
  });
});
