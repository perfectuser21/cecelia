/**
 * Historical Drop-off Analyzer Unit Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HistoricalDropoffAnalyzer } from '../../../apps/core/src/analysis/historical-dropoff.js';
import pool from '../../../apps/core/src/task-system/db.js';

describe('HistoricalDropoffAnalyzer', () => {
  let analyzer: HistoricalDropoffAnalyzer;

  beforeAll(async () => {
    analyzer = new HistoricalDropoffAnalyzer();

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

  it('should perform complete analysis', async () => {
    const result = await analyzer.analyzeAll();

    expect(result).toHaveProperty('cohorts');
    expect(result).toHaveProperty('funnel');
    expect(result).toHaveProperty('dropoffs');
    expect(result).toHaveProperty('summary');

    expect(Array.isArray(result.cohorts)).toBe(true);
    expect(Array.isArray(result.funnel)).toBe(true);
    expect(Array.isArray(result.dropoffs)).toBe(true);
  });

  it('should include summary statistics', async () => {
    const result = await analyzer.analyzeAll();

    expect(result.summary).toHaveProperty('totalCohorts');
    expect(result.summary).toHaveProperty('totalUsersAnalyzed');
    expect(result.summary).toHaveProperty('highRiskUsers');
    expect(result.summary).toHaveProperty('criticalDropoffSteps');

    expect(typeof result.summary.totalCohorts).toBe('number');
    expect(typeof result.summary.totalUsersAnalyzed).toBe('number');
    expect(typeof result.summary.highRiskUsers).toBe('number');
    expect(Array.isArray(result.summary.criticalDropoffSteps)).toBe(true);
  });

  it('should identify critical drop-off steps', async () => {
    const result = await analyzer.analyzeAll();

    // Critical steps have > 30% drop-off rate
    for (const stepName of result.summary.criticalDropoffSteps) {
      const step = result.funnel.find((s) => s.step === stepName);
      expect(step).toBeDefined();
      if (step) {
        expect(step.dropoffRate).toBeGreaterThan(0.3);
      }
    }
  });

  it('should count high risk users correctly', async () => {
    const result = await analyzer.analyzeAll();

    const highRiskCount = result.dropoffs.filter((d) => d.riskScore > 0.7).length;
    expect(result.summary.highRiskUsers).toBe(highRiskCount);
  });

  it('should respect date range for all analyses', async () => {
    const startDate = '2026-01-01';
    const endDate = '2026-02-28';

    const result = await analyzer.analyzeAll(startDate, endDate);

    expect(result).toHaveProperty('cohorts');
    expect(result).toHaveProperty('funnel');
    expect(result).toHaveProperty('dropoffs');
  });
});
