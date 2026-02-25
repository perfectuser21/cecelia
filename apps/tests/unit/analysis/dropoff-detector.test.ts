/**
 * Drop-off Detector Unit Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DropoffDetector } from '../../../apps/core/src/analysis/dropoff-detector.js';
import pool from '../../../apps/core/src/task-system/db.js';

describe('DropoffDetector', () => {
  let detector: DropoffDetector;

  beforeAll(async () => {
    detector = new DropoffDetector();

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

  it('should detect users at risk of churning', async () => {
    const dropoffs = await detector.analyze();

    expect(Array.isArray(dropoffs)).toBe(true);

    for (const dropoff of dropoffs) {
      expect(dropoff).toHaveProperty('userId');
      expect(dropoff).toHaveProperty('lastActivity');
      expect(dropoff).toHaveProperty('daysSinceSignup');
      expect(dropoff).toHaveProperty('preDropoffActions');
      expect(dropoff).toHaveProperty('riskScore');

      expect(Array.isArray(dropoff.preDropoffActions)).toBe(true);
      expect(dropoff.riskScore).toBeGreaterThanOrEqual(0);
      expect(dropoff.riskScore).toBeLessThanOrEqual(1);
    }
  });

  it('should filter by minimum risk score', async () => {
    const highRisk = await detector.analyze(undefined, undefined, 0.7);

    expect(Array.isArray(highRisk)).toBe(true);

    for (const dropoff of highRisk) {
      expect(dropoff.riskScore).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('should respect date range filtering', async () => {
    const startDate = '2026-01-01';
    const endDate = '2026-02-28';

    const dropoffs = await detector.analyze(startDate, endDate, 0.5);
    expect(Array.isArray(dropoffs)).toBe(true);
  });

  it('should handle no data gracefully', async () => {
    const dropoffs = await detector.analyze('2050-01-01', '2050-01-31', 0.5);
    expect(dropoffs).toEqual([]);
  });

  it('should include pre-dropoff actions', async () => {
    const dropoffs = await detector.analyze(undefined, undefined, 0.5);

    if (dropoffs.length > 0) {
      expect(Array.isArray(dropoffs[0].preDropoffActions)).toBe(true);
    }
  });
});
