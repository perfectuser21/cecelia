/**
 * Analysis API Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import analysisRoutes from '../../../apps/core/src/analysis/routes.js';
import pool from '../../../apps/core/src/task-system/db.js';

describe('Analysis API', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/analysis', analysisRoutes);

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
    await pool.query('DROP TABLE IF EXISTS user_activities');
    await pool.query('DROP TABLE IF EXISTS users');
  });

  describe('GET /api/analysis/cohorts', () => {
    it('should return cohort analysis data', async () => {
      const response = await request(app).get('/api/analysis/cohorts');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should support date range filtering', async () => {
      const response = await request(app)
        .get('/api/analysis/cohorts')
        .query({ startDate: '2026-01-01', endDate: '2026-02-28' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should support groupBy parameter', async () => {
      const response = await request(app)
        .get('/api/analysis/cohorts')
        .query({ groupBy: 'month' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/analysis/funnel', () => {
    it('should return funnel analysis data', async () => {
      const response = await request(app).get('/api/analysis/funnel');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should support date range filtering', async () => {
      const response = await request(app)
        .get('/api/analysis/funnel')
        .query({ startDate: '2026-01-01', endDate: '2026-02-28' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/analysis/dropoff', () => {
    it('should return drop-off analysis data', async () => {
      const response = await request(app).get('/api/analysis/dropoff');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should support minRiskScore filtering', async () => {
      const response = await request(app)
        .get('/api/analysis/dropoff')
        .query({ minRiskScore: '0.7' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      for (const dropoff of response.body.data) {
        expect(dropoff.riskScore).toBeGreaterThanOrEqual(0.7);
      }
    });
  });

  describe('GET /api/analysis/complete', () => {
    it('should return complete analysis', async () => {
      const response = await request(app).get('/api/analysis/complete');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');

      const data = response.body.data;
      expect(data).toHaveProperty('cohorts');
      expect(data).toHaveProperty('funnel');
      expect(data).toHaveProperty('dropoffs');
      expect(data).toHaveProperty('summary');
    });

    it('should include all summary fields', async () => {
      const response = await request(app).get('/api/analysis/complete');

      const summary = response.body.data.summary;
      expect(summary).toHaveProperty('totalCohorts');
      expect(summary).toHaveProperty('totalUsersAnalyzed');
      expect(summary).toHaveProperty('highRiskUsers');
      expect(summary).toHaveProperty('criticalDropoffSteps');
    });
  });

  describe('GET /api/analysis/health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/api/analysis/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
    });
  });
});
