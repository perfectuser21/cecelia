/**
 * Cortex Quality Feedback Tests
 * Tests user feedback recording and effectiveness score updates
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import {
  recordQualityFeedback,
  updateEffectivenessScore,
  incrementReoccurrence,
} from '../cortex-quality.js';

const { Pool } = pg;
let pool;

beforeAll(async () => {
  pool = new Pool(DB_DEFAULTS);
});

afterAll(async () => {
  await pool.end();
});

describe('recordQualityFeedback', () => {
  let testAnalysisId;

  beforeEach(async () => {
    // Create test analysis
    const result = await pool.query(`
      INSERT INTO cortex_analyses (
        root_cause,
        contributing_factors,
        mitigations,
        learnings,
        strategy_adjustments,
        analysis_depth,
        confidence_score,
        analyst,
        quality_score,
        quality_dimensions
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      'Network timeout',
      JSON.stringify(['factor1', 'factor2']),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      'deep',
      0.9,
      'cortex',
      25,
      JSON.stringify({ completeness: 25, effectiveness: 0, timeliness: 0, uniqueness: 0 }),
    ]);

    testAnalysisId = result.rows[0].id;
  });

  it('should record user feedback successfully', async () => {
    const result = await recordQualityFeedback(testAnalysisId, 5, 'Very helpful analysis');

    expect(result).toHaveProperty('id', testAnalysisId);
    expect(result).toHaveProperty('user_feedback', 5);
    expect(result).toHaveProperty('feedback_comment', 'Very helpful analysis');
  });

  it('should reject invalid rating (< 1)', async () => {
    await expect(recordQualityFeedback(testAnalysisId, 0, 'Invalid')).rejects.toThrow(
      'rating must be a number between 1 and 5'
    );
  });

  it('should reject invalid rating (> 5)', async () => {
    await expect(recordQualityFeedback(testAnalysisId, 6, 'Invalid')).rejects.toThrow(
      'rating must be a number between 1 and 5'
    );
  });

  it('should require analysis_id', async () => {
    await expect(recordQualityFeedback(null, 5)).rejects.toThrow('analysis_id is required');
  });

  it('should update feedback_updated_at timestamp', async () => {
    await recordQualityFeedback(testAnalysisId, 4);

    const result = await pool.query(`
      SELECT feedback_updated_at
      FROM cortex_analyses
      WHERE id = $1
    `, [testAnalysisId]);

    expect(result.rows[0].feedback_updated_at).toBeTruthy();
  });

  it('should allow feedback without comment', async () => {
    const result = await recordQualityFeedback(testAnalysisId, 3);

    expect(result.user_feedback).toBe(3);
    expect(result.feedback_comment).toBeNull();
  });
});

describe('updateEffectivenessScore', () => {
  let testAnalysisId;

  beforeEach(async () => {
    const result = await pool.query(`
      INSERT INTO cortex_analyses (
        root_cause,
        contributing_factors,
        mitigations,
        learnings,
        strategy_adjustments,
        analysis_depth,
        confidence_score,
        analyst,
        quality_score,
        quality_dimensions
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      'Network timeout',
      JSON.stringify(['factor1', 'factor2']),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      'deep',
      0.9,
      'cortex',
      25,
      JSON.stringify({ completeness: 25, effectiveness: 0, timeliness: 0, uniqueness: 0 }),
    ]);

    testAnalysisId = result.rows[0].id;
  });

  it('should calculate effectiveness score based on 5-star feedback', async () => {
    await recordQualityFeedback(testAnalysisId, 5);
    const result = await updateEffectivenessScore(testAnalysisId);

    expect(result.dimensions.effectiveness).toBe(40); // 5 * 8 = 40
    expect(result.quality_score).toBe(65); // 25 + 40 + 0 + 0
  });

  it('should calculate effectiveness score based on 4-star feedback', async () => {
    await recordQualityFeedback(testAnalysisId, 4);
    const result = await updateEffectivenessScore(testAnalysisId);

    expect(result.dimensions.effectiveness).toBe(32); // 4 * 8 = 32
    expect(result.quality_score).toBe(57); // 25 + 32 + 0 + 0
  });

  it('should calculate effectiveness score based on 3-star feedback', async () => {
    await recordQualityFeedback(testAnalysisId, 3);
    const result = await updateEffectivenessScore(testAnalysisId);

    expect(result.dimensions.effectiveness).toBe(24); // 3 * 8 = 24
    expect(result.quality_score).toBe(49); // 25 + 24 + 0 + 0
  });

  it('should apply reoccurrence penalty (1 time = -5 points)', async () => {
    await recordQualityFeedback(testAnalysisId, 5);
    await pool.query(`UPDATE cortex_analyses SET reoccurrence_count = 1 WHERE id = $1`, [testAnalysisId]);

    const result = await updateEffectivenessScore(testAnalysisId);

    expect(result.dimensions.effectiveness).toBe(35); // 40 - 5 = 35
    expect(result.reoccurrence_penalty).toBe(5);
  });

  it('should apply reoccurrence penalty (2 times = -10 points)', async () => {
    await recordQualityFeedback(testAnalysisId, 5);
    await pool.query(`UPDATE cortex_analyses SET reoccurrence_count = 2 WHERE id = $1`, [testAnalysisId]);

    const result = await updateEffectivenessScore(testAnalysisId);

    expect(result.dimensions.effectiveness).toBe(30); // 40 - 10 = 30
    expect(result.reoccurrence_penalty).toBe(10);
  });

  it('should apply reoccurrence penalty (3+ times = -20 points)', async () => {
    await recordQualityFeedback(testAnalysisId, 5);
    await pool.query(`UPDATE cortex_analyses SET reoccurrence_count = 3 WHERE id = $1`, [testAnalysisId]);

    const result = await updateEffectivenessScore(testAnalysisId);

    expect(result.dimensions.effectiveness).toBe(20); // 40 - 20 = 20
    expect(result.reoccurrence_penalty).toBe(20);
  });

  it('should not allow negative effectiveness score', async () => {
    await recordQualityFeedback(testAnalysisId, 1); // 1 * 8 = 8 points
    await pool.query(`UPDATE cortex_analyses SET reoccurrence_count = 3 WHERE id = $1`, [testAnalysisId]);

    const result = await updateEffectivenessScore(testAnalysisId);

    expect(result.dimensions.effectiveness).toBe(0); // Math.max(0, 8 - 20) = 0
  });

  it('should handle analysis without user feedback', async () => {
    const result = await updateEffectivenessScore(testAnalysisId);

    expect(result.dimensions.effectiveness).toBe(0); // No feedback = 0 points
    expect(result.quality_score).toBe(25); // Only completeness score
  });
});

describe('incrementReoccurrence', () => {
  let testAnalysisId;

  beforeEach(async () => {
    const result = await pool.query(`
      INSERT INTO cortex_analyses (
        root_cause,
        contributing_factors,
        mitigations,
        learnings,
        strategy_adjustments,
        analysis_depth,
        confidence_score,
        analyst,
        quality_score,
        quality_dimensions,
        user_feedback
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `, [
      'Network timeout',
      JSON.stringify(['factor1', 'factor2']),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      'deep',
      0.9,
      'cortex',
      65,
      JSON.stringify({ completeness: 25, effectiveness: 40, timeliness: 0, uniqueness: 0 }),
      5,
    ]);

    testAnalysisId = result.rows[0].id;
  });

  it('should increment reoccurrence count from 0 to 1', async () => {
    const result = await incrementReoccurrence(testAnalysisId);

    expect(result.reoccurrence_count).toBe(1);
    expect(result.last_reoccurrence_at).toBeTruthy();
  });

  it('should increment existing reoccurrence count', async () => {
    await incrementReoccurrence(testAnalysisId);
    const result = await incrementReoccurrence(testAnalysisId);

    expect(result.reoccurrence_count).toBe(2);
  });

  it('should automatically update effectiveness score after reoccurrence', async () => {
    await incrementReoccurrence(testAnalysisId);

    const result = await pool.query(`
      SELECT quality_score, quality_dimensions
      FROM cortex_analyses
      WHERE id = $1
    `, [testAnalysisId]);

    const dimensions = result.rows[0].quality_dimensions;
    expect(dimensions.effectiveness).toBe(35); // 40 - 5 = 35 (1 reoccurrence)
    expect(parseInt(result.rows[0].quality_score)).toBe(60); // 25 + 35 + 0 + 0
  });
});
