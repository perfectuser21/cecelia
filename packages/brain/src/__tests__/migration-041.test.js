/**
 * Migration 041 Tests
 * Verifies that auto-cleanup SQL functions were created by migration 041.
 */

import { describe, it, expect } from 'vitest';
import pool from '../db.js';

describe('migration 041: auto-cleanup functions', () => {
  it('cleanup_alertness_metrics function exists', async () => {
    const result = await pool.query(`
      SELECT routine_name FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name = 'cleanup_alertness_metrics'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('cleanup_decision_log function exists', async () => {
    const result = await pool.query(`
      SELECT routine_name FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name = 'cleanup_decision_log'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('cleanup_cecelia_events function exists', async () => {
    const result = await pool.query(`
      SELECT routine_name FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name = 'cleanup_cecelia_events'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('cleanup_decisions function exists', async () => {
    const result = await pool.query(`
      SELECT routine_name FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name = 'cleanup_decisions'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('run_periodic_cleanup master function exists', async () => {
    const result = await pool.query(`
      SELECT routine_name FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name = 'run_periodic_cleanup'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('cleanup_alertness_metrics returns a number', async () => {
    const result = await pool.query('SELECT cleanup_alertness_metrics(0) AS n');
    expect(typeof result.rows[0].n).toBe('number');
  });

  it('cleanup_decision_log returns a number', async () => {
    const result = await pool.query('SELECT cleanup_decision_log(0) AS n');
    expect(typeof result.rows[0].n).toBe('number');
  });

  it('run_periodic_cleanup returns a text summary', async () => {
    const result = await pool.query('SELECT run_periodic_cleanup() AS msg');
    expect(result.rows[0].msg).toMatch(/cleanup done:/);
  });
});
