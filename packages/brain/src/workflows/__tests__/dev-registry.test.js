import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: 'postgresql://localhost/cecelia' });

afterAll(() => pool.end());

describe('dev-registry migration — 7 张表存在', () => {
  const TABLES = [
    'journeys', 'journey_steps', 'journey_features',
    'api_registry', 'db_schema_registry', 'test_registry', 'issues',
  ];

  it.each(TABLES)('表 %s 存在', async (tableName) => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name=$1`,
      [tableName],
    );
    expect(rows).toHaveLength(1);
  });

  it('journeys.journey_type 有 CHECK 约束', async () => {
    const { rows } = await pool.query(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name='journeys' AND constraint_type='CHECK'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('journey_steps 有 UNIQUE(journey_id, step_number)', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename='journey_steps' AND indexdef LIKE '%journey_id%step_number%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('api_registry 有 UNIQUE(method, path)', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename='api_registry' AND indexdef LIKE '%method%path%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
