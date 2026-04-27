import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../../packages/brain/migrations/247_initiative_preflight_results.sql',
);

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgres://cecelia:cecelia@localhost:5432/cecelia_test';

describe('Workstream 1 — initiative_preflight_results migration [BEHAVIOR]', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('migration applies cleanly to empty schema and creates initiative_preflight_results table with required columns', async () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');

    await pool.query('DROP TABLE IF EXISTS initiative_preflight_results CASCADE');
    await pool.query(sql);

    const exists = await pool.query(
      "SELECT to_regclass('public.initiative_preflight_results')::text AS name",
    );
    expect(exists.rows[0].name).toBe('initiative_preflight_results');

    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'initiative_preflight_results'`,
    );
    const names = cols.rows.map((r: { column_name: string }) => r.column_name);
    expect(names).toContain('initiative_id');
    expect(names).toContain('status');
    expect(names).toContain('reasons');
    expect(names).toContain('checked_at');
  });

  it('migration is idempotent — applying twice does not throw', async () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');
    await pool.query(sql);
    await expect(pool.query(sql)).resolves.toBeDefined();
  });
});
