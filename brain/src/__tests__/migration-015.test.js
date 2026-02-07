/**
 * Migration 015 Tests
 *
 * Tests schema changes for Cortex quality assessment system
 */

import { describe, it, expect, beforeAll } from 'vitest';
import pool from '../db.js';

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
      WHERE table_name = 'cortex_analyses'
        AND column_name = 'quality_score'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('integer');
  });

  it('cortex_analyses table has quality_dimensions column', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'cortex_analyses'
        AND column_name = 'quality_dimensions'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('jsonb');
  });

  it('cortex_analyses table has similarity_hash column', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'cortex_analyses'
        AND column_name = 'similarity_hash'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('text');
  });

  it('cortex_analyses table has duplicate_of column', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'cortex_analyses'
        AND column_name = 'duplicate_of'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('uuid');
  });

  it('cortex_quality_reports table exists', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'cortex_quality_reports'
    `);

    expect(result.rows.length).toBe(1);
  });

  it('strategy_adoptions table exists', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'strategy_adoptions'
    `);

    expect(result.rows.length).toBe(1);
  });

  it('similarity_hash index exists', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'cortex_analyses'
        AND indexname = 'idx_cortex_analyses_similarity_hash'
    `);

    expect(result.rows.length).toBe(1);
  });
});
