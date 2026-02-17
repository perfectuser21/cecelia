/**
 * Funnel Analyzer Unit Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FunnelAnalyzer } from '../../../apps/core/src/analysis/funnel-analyzer.js';
import pool from '../../../apps/core/src/task-system/db.js';

describe('FunnelAnalyzer', () => {
  let analyzer: FunnelAnalyzer;

  beforeAll(async () => {
    analyzer = new FunnelAnalyzer();

    // Tables should already exist from cohort-analyzer tests
    // but create them just in case tests run independently
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
    await pool.query('DROP TABLE IF EXISTS user_activities');
    await pool.query('DROP TABLE IF EXISTS users');
  });

  it('should return all funnel steps', async () => {
    const funnel = await analyzer.analyze();

    expect(Array.isArray(funnel)).toBe(true);
    expect(funnel.length).toBeGreaterThanOrEqual(4);

    const stepNames = funnel.map((s) => s.step);
    expect(stepNames).toContain('signup');
    expect(stepNames).toContain('activation');
    expect(stepNames).toContain('week1_retention');
    expect(stepNames).toContain('week2_retention');
  });

  it('should calculate drop-off rates correctly', async () => {
    const funnel = await analyzer.analyze();

    for (const step of funnel) {
      expect(step).toHaveProperty('step');
      expect(step).toHaveProperty('users');
      expect(step).toHaveProperty('dropoffRate');
      expect(step.dropoffRate).toBeGreaterThanOrEqual(0);
      expect(step.dropoffRate).toBeLessThanOrEqual(1);
    }

    // First step should have 0 drop-off
    expect(funnel[0].dropoffRate).toBe(0);
  });

  it('should respect date range filtering', async () => {
    const startDate = '2026-01-01';
    const endDate = '2026-02-28';

    const funnel = await analyzer.analyze(startDate, endDate);
    expect(Array.isArray(funnel)).toBe(true);
    expect(funnel.length).toBeGreaterThanOrEqual(4);
  });

  it('should handle no users gracefully', async () => {
    const funnel = await analyzer.analyze('2050-01-01', '2050-01-31');

    expect(Array.isArray(funnel)).toBe(true);
    for (const step of funnel) {
      expect(step.users).toBe(0);
    }
  });
});
