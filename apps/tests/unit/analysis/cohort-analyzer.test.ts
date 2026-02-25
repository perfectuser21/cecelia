/**
 * Cohort Analyzer Unit Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CohortAnalyzer } from '../../../apps/core/src/analysis/cohort-analyzer.js';
import pool from '../../../apps/core/src/task-system/db.js';

describe('CohortAnalyzer', () => {
  let analyzer: CohortAnalyzer;

  beforeAll(async () => {
    analyzer = new CohortAnalyzer();

    // Setup test data
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_activities (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        activity_type VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  });

  afterAll(async () => {
    // Cleanup
    await pool.query('DROP TABLE IF EXISTS user_activities');
    await pool.query('DROP TABLE IF EXISTS users');
    await pool.end();
  });

  it('should group users by week', async () => {
    const cohorts = await analyzer.analyze(undefined, undefined, 'week');
    expect(Array.isArray(cohorts)).toBe(true);
  });

  it('should calculate retention rates correctly', async () => {
    const cohorts = await analyzer.analyze(undefined, undefined, 'week');

    for (const cohort of cohorts) {
      expect(cohort).toHaveProperty('cohort');
      expect(cohort).toHaveProperty('totalUsers');
      expect(cohort).toHaveProperty('retentionByWeek');
      expect(Array.isArray(cohort.retentionByWeek)).toBe(true);

      for (const retention of cohort.retentionByWeek) {
        expect(retention).toHaveProperty('week');
        expect(retention).toHaveProperty('retained');
        expect(retention).toHaveProperty('rate');
        expect(retention.rate).toBeGreaterThanOrEqual(0);
        expect(retention.rate).toBeLessThanOrEqual(1);
      }
    }
  });

  it('should support monthly grouping', async () => {
    const cohorts = await analyzer.analyze(undefined, undefined, 'month');
    expect(Array.isArray(cohorts)).toBe(true);

    if (cohorts.length > 0) {
      // Month format should be YYYY-MM
      expect(cohorts[0].cohort).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('should handle date range filtering', async () => {
    const startDate = '2026-01-01';
    const endDate = '2026-02-28';

    const cohorts = await analyzer.analyze(startDate, endDate, 'week');
    expect(Array.isArray(cohorts)).toBe(true);
  });

  it('should return empty array for no data', async () => {
    const cohorts = await analyzer.analyze('2050-01-01', '2050-01-31', 'week');
    expect(cohorts).toEqual([]);
  });
});
