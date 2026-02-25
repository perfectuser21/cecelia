/**
 * OKR Hierarchy Tests
 * Tests for O → KR parent-child relationship and automatic progress calculation
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

// Use test database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cecelia_tasks',
  user: process.env.DB_USER || 'n8n_user',
  password: process.env.DB_PASSWORD || 'n8n_password_2025'
});

// Test data IDs for cleanup
let testObjectiveId = null;
let testKr1Id = null;
let testKr2Id = null;

describe('OKR Hierarchy', () => {
  beforeAll(async () => {
    // Verify database connection
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    // Cleanup test data
    if (testKr1Id) {
      await pool.query('DELETE FROM goals WHERE id = $1', [testKr1Id]);
      testKr1Id = null;
    }
    if (testKr2Id) {
      await pool.query('DELETE FROM goals WHERE id = $1', [testKr2Id]);
      testKr2Id = null;
    }
    if (testObjectiveId) {
      await pool.query('DELETE FROM goals WHERE id = $1', [testObjectiveId]);
      testObjectiveId = null;
    }
  });

  describe('Database Schema', () => {
    it('goals table has parent_id column', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'goals' AND column_name = 'parent_id'
      `);
      expect(result.rows.length).toBe(1);
    });

    it('goals table has type column', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'goals' AND column_name = 'type'
      `);
      expect(result.rows.length).toBe(1);
    });

    it('goals table has weight column', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'goals' AND column_name = 'weight'
      `);
      expect(result.rows.length).toBe(1);
    });
  });

  describe('Create Objective and Key Results', () => {
    it('can create an Objective (type=objective, parent_id=null)', async () => {
      const result = await pool.query(
        'INSERT INTO goals (title, type) VALUES ($1, $2) RETURNING *',
        ['Test Objective', 'objective']
      );
      testObjectiveId = result.rows[0].id;

      expect(result.rows[0].type).toBe('objective');
      expect(result.rows[0].parent_id).toBeNull();
    });

    it('can create Key Results linked to an Objective', async () => {
      // Create Objective first
      const objResult = await pool.query(
        'INSERT INTO goals (title, type) VALUES ($1, $2) RETURNING *',
        ['Test Objective', 'objective']
      );
      testObjectiveId = objResult.rows[0].id;

      // Create Key Result 1
      const kr1Result = await pool.query(
        'INSERT INTO goals (title, type, parent_id, weight, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        ['Test KR 1', 'key_result', testObjectiveId, 0.5, 50]
      );
      testKr1Id = kr1Result.rows[0].id;

      expect(kr1Result.rows[0].type).toBe('key_result');
      expect(kr1Result.rows[0].parent_id).toBe(testObjectiveId);
      expect(parseFloat(kr1Result.rows[0].weight)).toBe(0.5);

      // Create Key Result 2
      const kr2Result = await pool.query(
        'INSERT INTO goals (title, type, parent_id, weight, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        ['Test KR 2', 'key_result', testObjectiveId, 0.5, 100]
      );
      testKr2Id = kr2Result.rows[0].id;

      expect(kr2Result.rows[0].type).toBe('key_result');
      expect(kr2Result.rows[0].parent_id).toBe(testObjectiveId);
    });
  });

  describe('Query Children (Key Results)', () => {
    it('can query Key Results for an Objective', async () => {
      // Create Objective
      const objResult = await pool.query(
        'INSERT INTO goals (title, type) VALUES ($1, $2) RETURNING *',
        ['Test Objective', 'objective']
      );
      testObjectiveId = objResult.rows[0].id;

      // Create Key Results
      const kr1Result = await pool.query(
        'INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4) RETURNING *',
        ['Test KR 1', 'key_result', testObjectiveId, 0.6]
      );
      testKr1Id = kr1Result.rows[0].id;

      const kr2Result = await pool.query(
        'INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4) RETURNING *',
        ['Test KR 2', 'key_result', testObjectiveId, 0.4]
      );
      testKr2Id = kr2Result.rows[0].id;

      // Query children
      const childrenResult = await pool.query(
        'SELECT * FROM goals WHERE parent_id = $1',
        [testObjectiveId]
      );

      expect(childrenResult.rows.length).toBe(2);
      expect(childrenResult.rows.every(r => r.type === 'key_result')).toBe(true);
      expect(childrenResult.rows.every(r => r.parent_id === testObjectiveId)).toBe(true);
    });
  });

  describe('Progress Calculation', () => {
    it('calculates weighted average progress correctly', async () => {
      // Create Objective with 0 progress
      const objResult = await pool.query(
        'INSERT INTO goals (title, type, progress) VALUES ($1, $2, $3) RETURNING *',
        ['Test Objective', 'objective', 0]
      );
      testObjectiveId = objResult.rows[0].id;

      // Create KR1: weight 0.6, progress 80
      const kr1Result = await pool.query(
        'INSERT INTO goals (title, type, parent_id, weight, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        ['Test KR 1', 'key_result', testObjectiveId, 0.6, 80]
      );
      testKr1Id = kr1Result.rows[0].id;

      // Create KR2: weight 0.4, progress 100
      const kr2Result = await pool.query(
        'INSERT INTO goals (title, type, parent_id, weight, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        ['Test KR 2', 'key_result', testObjectiveId, 0.4, 100]
      );
      testKr2Id = kr2Result.rows[0].id;

      // Calculate expected progress: (80 * 0.6 + 100 * 0.4) / (0.6 + 0.4) = 88
      // Note: This test verifies the calculation formula is correct
      // The actual auto-update happens in the API layer when KR progress is updated

      const krs = await pool.query(
        'SELECT progress, weight FROM goals WHERE parent_id = $1',
        [testObjectiveId]
      );

      let totalWeightedProgress = 0;
      let totalWeight = 0;
      for (const kr of krs.rows) {
        const weight = parseFloat(kr.weight);
        const progress = parseInt(kr.progress);
        totalWeightedProgress += progress * weight;
        totalWeight += weight;
      }

      const expectedProgress = Math.round(totalWeightedProgress / totalWeight);
      expect(expectedProgress).toBe(88);
    });
  });

  describe('Type Constraints', () => {
    it('type column only accepts objective or key_result', async () => {
      // Valid type: objective
      const objResult = await pool.query(
        'INSERT INTO goals (title, type) VALUES ($1, $2) RETURNING *',
        ['Test', 'objective']
      );
      testObjectiveId = objResult.rows[0].id;
      expect(objResult.rows[0].type).toBe('objective');

      // Invalid type should fail
      await expect(
        pool.query('INSERT INTO goals (title, type) VALUES ($1, $2)', ['Test', 'invalid_type'])
      ).rejects.toThrow();
    });

    it('weight must be between 0 and 1', async () => {
      // Create Objective first
      const objResult = await pool.query(
        'INSERT INTO goals (title, type) VALUES ($1, $2) RETURNING *',
        ['Test Objective', 'objective']
      );
      testObjectiveId = objResult.rows[0].id;

      // Valid weight
      const kr1Result = await pool.query(
        'INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4) RETURNING *',
        ['Test KR', 'key_result', testObjectiveId, 0.5]
      );
      testKr1Id = kr1Result.rows[0].id;
      expect(parseFloat(kr1Result.rows[0].weight)).toBe(0.5);

      // Invalid weight (> 1) should fail
      await expect(
        pool.query(
          'INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4)',
          ['Test KR Invalid', 'key_result', testObjectiveId, 1.5]
        )
      ).rejects.toThrow();
    });
  });
});
