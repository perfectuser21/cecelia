/**
 * Migration 016 Tests - Immune System Connections
 * Tests:
 * - strategy_effectiveness table creation
 * - cortex_analyses new columns (user_feedback, feedback_comment, reoccurrence_count, etc.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;
let pool;

beforeAll(async () => {
  pool = new Pool(DB_DEFAULTS);
});

afterAll(async () => {
  await pool.end();
});

describe('Migration 016 - Immune System Connections', () => {
  it('should have strategy_effectiveness table', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'strategy_effectiveness'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].table_name).toBe('strategy_effectiveness');
  });

  it('strategy_effectiveness table should have all required columns', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'strategy_effectiveness'
      ORDER BY column_name
    `);

    const columns = result.rows.reduce((acc, row) => {
      acc[row.column_name] = row.data_type;
      return acc;
    }, {});

    expect(columns).toHaveProperty('id', 'uuid');
    expect(columns).toHaveProperty('adoption_id', 'uuid');
    expect(columns).toHaveProperty('strategy_key', 'text');
    expect(columns).toHaveProperty('baseline_success_rate', 'numeric');
    expect(columns).toHaveProperty('post_adjustment_success_rate', 'numeric');
    expect(columns).toHaveProperty('sample_size', 'integer');
    expect(columns).toHaveProperty('evaluation_period_days', 'integer');
    expect(columns).toHaveProperty('is_effective', 'boolean');
    expect(columns).toHaveProperty('improvement_percentage', 'numeric');
    expect(columns).toHaveProperty('evaluated_at');
    expect(columns).toHaveProperty('created_at');
  });

  it('cortex_analyses should have user_feedback column', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cortex_analyses'
        AND column_name = 'user_feedback'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('integer');
  });

  it('cortex_analyses should have feedback_comment column', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cortex_analyses'
        AND column_name = 'feedback_comment'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('text');
  });

  it('cortex_analyses should have reoccurrence_count column', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cortex_analyses'
        AND column_name = 'reoccurrence_count'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('integer');
  });

  it('cortex_analyses should have last_reoccurrence_at column', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cortex_analyses'
        AND column_name = 'last_reoccurrence_at'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toContain('timestamp');
  });

  it('cortex_analyses should have feedback_updated_at column', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cortex_analyses'
        AND column_name = 'feedback_updated_at'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toContain('timestamp');
  });

  it('strategy_effectiveness should have UNIQUE constraint on adoption_id', async () => {
    const result = await pool.query(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = 'strategy_effectiveness'::regclass
        AND contype = 'u'
        AND conkey @> ARRAY[(
          SELECT attnum FROM pg_attribute
          WHERE attrelid = 'strategy_effectiveness'::regclass
            AND attname = 'adoption_id'
        )]
    `);

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].contype).toBe('u'); // 'u' = unique constraint
  });

  it('strategy_effectiveness should have index on strategy_key', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'strategy_effectiveness'
        AND indexname = 'idx_strategy_effectiveness_strategy_key'
    `);

    expect(result.rows.length).toBe(1);
  });
});
