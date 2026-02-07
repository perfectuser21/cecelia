/**
 * Learning Effectiveness Tests
 * Tests strategy adjustment effectiveness evaluation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { evaluateStrategyEffectiveness } from '../learning.js';

const { Pool } = pg;
let pool;

beforeAll(async () => {
  pool = new Pool(DB_DEFAULTS);
});

afterAll(async () => {
  await pool.end();
});

describe('evaluateStrategyEffectiveness', () => {
  let testAdoptionId;
  let testStrategyKey;

  beforeEach(async () => {
    // Clean up all test data from previous tests
    await pool.query('DELETE FROM strategy_effectiveness');
    await pool.query('DELETE FROM strategy_adoptions');
    await pool.query('DELETE FROM tasks');

    // Create test strategy adoption record
    testStrategyKey = `test.strategy.${Date.now()}`;
    const adoptedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

    const adoptionResult = await pool.query(`
      INSERT INTO strategy_adoptions (
        strategy_key,
        old_value,
        new_value,
        adopted_at,
        adopted_by
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [testStrategyKey, '3', '5', adoptedAt, 'test_system']);

    testAdoptionId = adoptionResult.rows[0].id;

    // Create baseline tasks (before adoption)
    const baselineStart = new Date(adoptedAt.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (let i = 0; i < 10; i++) {
      await pool.query(`
        INSERT INTO tasks (title, task_type, status, created_at)
        VALUES ($1, $2, $3, $4)
      `, [
        `Baseline Task ${i}`,
        'dev',
        i < 6 ? 'completed' : 'failed', // 60% success rate
        new Date(baselineStart.getTime() + i * 60000),
      ]);
    }

    // Create post-adjustment tasks (after adoption)
    const postStart = adoptedAt;

    for (let i = 0; i < 10; i++) {
      await pool.query(`
        INSERT INTO tasks (title, task_type, status, created_at)
        VALUES ($1, $2, $3, $4)
      `, [
        `Post Task ${i}`,
        'dev',
        i < 8 ? 'completed' : 'failed', // 80% success rate (improvement)
        new Date(postStart.getTime() + i * 60000),
      ]);
    }
  });

  it('should evaluate strategy effectiveness with improvement', async () => {
    const result = await evaluateStrategyEffectiveness(testStrategyKey, 7);

    expect(result).toHaveProperty('strategy_key', testStrategyKey);
    expect(result).toHaveProperty('evaluation_possible', true);
    expect(result).toHaveProperty('baseline_success_rate');
    expect(result).toHaveProperty('post_adjustment_success_rate');
    expect(result).toHaveProperty('is_effective');
    expect(result).toHaveProperty('improvement_percentage');

    // Baseline: 60%, Post: 80%, Improvement: 20%
    expect(result.baseline_success_rate).toBe(60);
    expect(result.post_adjustment_success_rate).toBe(80);
    expect(result.improvement_percentage).toBe(20);
    expect(result.is_effective).toBe(true); // >5% improvement
  });

  it('should save evaluation to strategy_effectiveness table', async () => {
    await evaluateStrategyEffectiveness(testStrategyKey, 7);

    const result = await pool.query(`
      SELECT *
      FROM strategy_effectiveness
      WHERE adoption_id = $1
    `, [testAdoptionId]);

    expect(result.rows.length).toBe(1);
    const record = result.rows[0];
    expect(record.strategy_key).toBe(testStrategyKey);
    expect(parseFloat(record.baseline_success_rate)).toBe(60);
    expect(parseFloat(record.post_adjustment_success_rate)).toBe(80);
    expect(record.is_effective).toBe(true);
    expect(parseFloat(record.improvement_percentage)).toBe(20);
  });

  it('should update effectiveness_score in strategy_adoptions', async () => {
    await evaluateStrategyEffectiveness(testStrategyKey, 7);

    const result = await pool.query(`
      SELECT effectiveness_score
      FROM strategy_adoptions
      WHERE id = $1
    `, [testAdoptionId]);

    expect(result.rows.length).toBe(1);
    const score = result.rows[0].effectiveness_score;
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(40); // Max 40 points
  });

  it('should return not found for non-existent strategy', async () => {
    const result = await evaluateStrategyEffectiveness('nonexistent.strategy', 7);

    expect(result).toHaveProperty('found', false);
    expect(result).toHaveProperty('message');
  });

  it('should handle strategy with no effectiveness (insufficient data)', async () => {
    // Create very recent adoption (< 7 days ago)
    const recentKey = `test.recent.${Date.now()}`;
    const recentAdoptedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago

    await pool.query(`
      INSERT INTO strategy_adoptions (
        strategy_key,
        old_value,
        new_value,
        adopted_at,
        adopted_by
      ) VALUES ($1, $2, $3, $4, $5)
    `, [recentKey, '3', '5', recentAdoptedAt, 'test_system']);

    const result = await evaluateStrategyEffectiveness(recentKey, 7);

    expect(result).toHaveProperty('evaluation_possible', false);
    expect(result).toHaveProperty('days_since_adoption');
    expect(result.days_since_adoption).toBeLessThan(7);
  });

  it('should detect ineffective strategies (no improvement)', async () => {
    // Clean up tasks first to avoid contamination
    await pool.query('DELETE FROM tasks');

    // Create strategy with no improvement (use different time to avoid overlap)
    const ineffectiveKey = `test.ineffective.${Date.now()}`;
    const adoptedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago (different from main test)

    const ineffectiveAdoptionResult = await pool.query(`
      INSERT INTO strategy_adoptions (
        strategy_key,
        old_value,
        new_value,
        adopted_at,
        adopted_by
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [ineffectiveKey, '3', '5', adoptedAt, 'test_system']);

    // Baseline: 60% success
    const baselineStart = new Date(adoptedAt.getTime() - 7 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 10; i++) {
      await pool.query(`
        INSERT INTO tasks (title, task_type, status, created_at)
        VALUES ($1, $2, $3, $4)
      `, [
        `Ineffective Baseline Task ${i}`,
        'dev',
        i < 6 ? 'completed' : 'failed',
        new Date(baselineStart.getTime() + i * 60000),
      ]);
    }

    // Post: Still 60% success (no improvement)
    const postStart = adoptedAt;
    for (let i = 0; i < 10; i++) {
      await pool.query(`
        INSERT INTO tasks (title, task_type, status, created_at)
        VALUES ($1, $2, $3, $4)
      `, [
        `Ineffective Post Task ${i}`,
        'dev',
        i < 6 ? 'completed' : 'failed',
        new Date(postStart.getTime() + i * 60000),
      ]);
    }

    const result = await evaluateStrategyEffectiveness(ineffectiveKey, 7);

    expect(result.baseline_success_rate).toBe(60);
    expect(result.post_adjustment_success_rate).toBe(60);
    expect(result.improvement_percentage).toBe(0);
    expect(result.is_effective).toBe(false); // No improvement >5%
  });

  it('should handle empty task sample gracefully', async () => {
    // Create strategy in future period with no tasks
    const futureKey = `test.future.${Date.now()}`;
    const futureAdoptedAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // Future

    await pool.query(`
      INSERT INTO strategy_adoptions (
        strategy_key,
        old_value,
        new_value,
        adopted_at,
        adopted_by
      ) VALUES ($1, $2, $3, $4, $5)
    `, [futureKey, '3', '5', futureAdoptedAt, 'test_system']);

    const result = await evaluateStrategyEffectiveness(futureKey, 7);

    expect(result).toHaveProperty('evaluation_possible', false);
  });

  it('should calculate sample_size correctly', async () => {
    const result = await evaluateStrategyEffectiveness(testStrategyKey, 7);

    expect(result).toHaveProperty('sample_size');
    expect(result.sample_size).toBe(10); // 10 tasks in post period
    expect(result.baseline_period.sample_size).toBe(10);
    expect(result.post_period.sample_size).toBe(10);
  });
});
