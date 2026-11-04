/**
 * Migration 041 Tests
 * Verifies that auto-cleanup SQL functions were created by migration 041.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, beginScratch, finishScratch, baseSchema, applyMigration } from './helpers/debt-03-scratch.js';
beforeAll(async () => {
  await beginScratch(); await baseSchema();
  await pool.query(`CREATE TABLE alertness_metrics(id serial PRIMARY KEY, "timestamp" timestamptz DEFAULT now());
    CREATE TABLE decision_log(id serial PRIMARY KEY, created_at timestamptz DEFAULT now());
    CREATE TABLE decisions(id serial PRIMARY KEY, created_at timestamptz DEFAULT now());`);
  await applyMigration('041_auto_cleanup_metrics.sql');
});
afterAll(finishScratch);

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

describe('cleanup retention effect',()=>{
  it.each([
    ['alertness_metrics','timestamp','cleanup_alertness_metrics',3],
    ['decision_log','created_at','cleanup_decision_log',7],
    ['cecelia_events','created_at','cleanup_cecelia_events',7],
    ['decisions','created_at','cleanup_decisions',30],
  ])('%s deletes expired rows and preserves fresh rows',async(table,column,fn,days)=>{
    await pool.query(`TRUNCATE ${table}`);
    await pool.query(`INSERT INTO ${table}("${column}") VALUES (NOW()-INTERVAL '${days+1} days'),(NOW()-INTERVAL '1 hour')`);
    expect((await pool.query(`SELECT ${fn}() AS n`)).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT ("${column}" > NOW()-INTERVAL '1 day') AS fresh FROM ${table}`)).rows).toEqual([{fresh:true}]);
    expect((await pool.query(`SELECT ${fn}() AS n`)).rows[0].n).toBe(0);
  });
});
