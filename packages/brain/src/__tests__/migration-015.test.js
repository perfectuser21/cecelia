import { createDebt02MigrationFixture } from './helpers/debt-02-scratch.js';
/**
 * Migration 015 Tests
 *
 * Tests schema changes for Cortex quality assessment system
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
let pool, fixture;
beforeAll(async () => {
  fixture = await createDebt02MigrationFixture(`
    CREATE TABLE schema_version(version text PRIMARY KEY, description text, applied_at timestamptz DEFAULT now());
    CREATE TABLE tasks(id uuid PRIMARY KEY, task_type text);
    CREATE TABLE cecelia_events(id integer PRIMARY KEY);
  `, ['013_cortex_analyses.sql', '015_cortex_quality_system.sql', '034_cleanup_orphan_tables_and_constraints.sql']);
  pool = fixture.pool;
});
afterAll(async () => { await fixture?.close(); });

describe('Migration 015 - Cortex Quality System', () => {
  beforeAll(async () => {
    // Ensure migration 015 has been applied
    const result = await pool.query(
      "SELECT version FROM schema_version WHERE version = '015'"
    );
    if (result.rows.length === 0) {
      throw new Error('Migration 015 not applied - run migrations first');
    }
  });

  it('cortex_analyses table has quality_score column', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'cortex_analyses'
        AND column_name = 'quality_score'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('integer');
  });

  it('cortex_analyses table has quality_dimensions column', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'cortex_analyses'
        AND column_name = 'quality_dimensions'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('jsonb');
  });

  it('cortex_analyses table has similarity_hash column', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'cortex_analyses'
        AND column_name = 'similarity_hash'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('text');
  });

  it('cortex_analyses table has duplicate_of column', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'cortex_analyses'
        AND column_name = 'duplicate_of'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('uuid');
  });

  it('cortex_quality_reports table dropped in Migration 034', async () => {
    // Migration 034 dropped this orphan table as part of comprehensive cleanup
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'cortex_quality_reports'
    `);

    expect(result.rows.length).toBe(0);
  });

  it('strategy_adoptions table exists', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'strategy_adoptions'
    `);

    expect(result.rows.length).toBe(1);
  });

  it('stores quality JSON and enforces duplicate-analysis foreign keys', async () => {
    const original = (await pool.query("INSERT INTO cortex_analyses(root_cause,quality_score,quality_dimensions,similarity_hash) VALUES('debt02',75,'{\"uniqueness\":15}','debt02-hash') RETURNING *")).rows[0];
    expect(original).toMatchObject({ quality_score: 75, quality_dimensions: { uniqueness: 15 }, similarity_hash: 'debt02-hash' });
    await pool.query("INSERT INTO cortex_analyses(root_cause,duplicate_of) VALUES('duplicate',$1)", [original.id]);
    await expect(pool.query("INSERT INTO cortex_analyses(root_cause,duplicate_of) VALUES('invalid','00000000-0000-0000-0000-000000000001')")).rejects.toMatchObject({ code: '23503' });
  });

  it('similarity_hash index exists', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'cortex_analyses'
        AND indexname = 'idx_cortex_analyses_similarity_hash'
    `);

    expect(result.rows.length).toBe(1);
  });
});
