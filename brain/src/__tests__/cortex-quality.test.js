/**
 * Cortex Quality Assessment Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pool from '../db.js';
import {
  evaluateQualityInitial,
  generateSimilarityHash,
  checkShouldCreateRCA,
  getQualityStats,
} from '../cortex-quality.js';

describe('Cortex Quality Assessment', () => {
  const testAnalysisIds = [];

  afterEach(async () => {
    // Clean up test analyses
    if (testAnalysisIds.length > 0) {
      await pool.query('DELETE FROM cortex_analyses WHERE id = ANY($1)', [testAnalysisIds]);
      testAnalysisIds.length = 0;
    }
  });

  describe('evaluateQualityInitial', () => {
    it('should calculate quality score based on completeness and timeliness', async () => {
      // Create test analysis
      const result = await pool.query(`
        INSERT INTO cortex_analyses (
          root_cause, contributing_factors, strategy_adjustments,
          analysis_depth, confidence_score, analyst
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        'Network timeout due to high latency',
        JSON.stringify(['factor1', 'factor2', 'factor3']),
        JSON.stringify([
          { key: 'retry.max_attempts', new_value: '5', reason: 'Increase retries' },
        ]),
        'deep',
        0.9,
        'cortex'
      ]);

      const analysisId = result.rows[0].id;
      testAnalysisIds.push(analysisId);

      // Evaluate quality
      const evaluation = await evaluateQualityInitial(analysisId);

      expect(evaluation.analysis_id).toBe(analysisId);
      expect(evaluation.quality_score).toBeGreaterThan(0);
      expect(evaluation.quality_score).toBeLessThanOrEqual(100);
      expect(evaluation.dimensions).toHaveProperty('completeness');
      expect(evaluation.dimensions).toHaveProperty('effectiveness');
      expect(evaluation.dimensions).toHaveProperty('timeliness');
      expect(evaluation.dimensions).toHaveProperty('uniqueness');

      // Check completeness is calculated
      // root_cause (37 chars < 50) = 10, factors (3) = 10, strategy with reason = 5 → total 25
      expect(evaluation.dimensions.completeness).toBe(25);
    });

    it('should save quality score to database', async () => {
      // Create test analysis
      const result = await pool.query(`
        INSERT INTO cortex_analyses (
          root_cause, analysis_depth, confidence_score, analyst
        ) VALUES ($1, $2, $3, $4)
        RETURNING id
      `, ['Test root cause', 'deep', 0.8, 'cortex']);

      const analysisId = result.rows[0].id;
      testAnalysisIds.push(analysisId);

      await evaluateQualityInitial(analysisId);

      // Verify saved
      const saved = await pool.query(
        'SELECT quality_score, quality_dimensions FROM cortex_analyses WHERE id = $1',
        [analysisId]
      );

      expect(saved.rows[0].quality_score).toBeGreaterThan(0);
      expect(saved.rows[0].quality_dimensions).toBeDefined();
      expect(saved.rows[0].quality_dimensions.completeness).toBeGreaterThanOrEqual(0);
    });

    it('should throw error for non-existent analysis', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000099';

      await expect(evaluateQualityInitial(fakeId)).rejects.toThrow('Analysis not found');
    });
  });

  describe('generateSimilarityHash', () => {
    it('should generate consistent hash for same input', () => {
      const context = {
        task_type: 'dev',
        reason: 'NETWORK',
        root_cause: 'Connection timeout'
      };

      const hash1 = generateSimilarityHash(context);
      const hash2 = generateSimilarityHash(context);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex length
    });

    it('should generate different hashes for different inputs', () => {
      const context1 = {
        task_type: 'dev',
        reason: 'NETWORK',
        root_cause: 'Connection timeout'
      };

      const context2 = {
        task_type: 'review',
        reason: 'BILLING_CAP',
        root_cause: 'Rate limit exceeded'
      };

      const hash1 = generateSimilarityHash(context1);
      const hash2 = generateSimilarityHash(context2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle missing fields gracefully', () => {
      const context = { task_type: 'dev' };

      const hash = generateSimilarityHash(context);

      expect(hash).toHaveLength(64);
    });
  });

  describe('checkShouldCreateRCA', () => {
    beforeEach(async () => {
      // Clean up any existing test analyses
      await pool.query("DELETE FROM cortex_analyses WHERE root_cause LIKE 'Test:%'");
    });

    it('should allow creation when no similar analyses exist', async () => {
      const context = {
        task_type: 'dev',
        reason: 'NETWORK',
        root_cause: 'Unique failure scenario'
      };

      const result = await checkShouldCreateRCA(context);

      expect(result.should_create).toBe(true);
      expect(result.duplicate_of).toBe(null);
      expect(result.similarity).toBe(0);
    });

    it('should detect high similarity and suggest reuse', async () => {
      // Create existing analysis with same hash
      const hash = generateSimilarityHash({
        task_type: 'dev',
        reason: 'NETWORK',
        root_cause: 'Test: Connection timeout error'
      });

      const existingResult = await pool.query(`
        INSERT INTO cortex_analyses (
          root_cause, similarity_hash, analysis_depth, confidence_score, analyst
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, ['Test: Connection timeout error', hash, 'deep', 0.8, 'cortex']);

      testAnalysisIds.push(existingResult.rows[0].id);

      // Check for duplicate
      const result = await checkShouldCreateRCA({
        task_type: 'dev',
        reason: 'NETWORK',
        root_cause: 'Test: Connection timeout error'
      });

      expect(result.similarity).toBeGreaterThan(80);
      expect(result.should_create).toBe(false);
      expect(result.duplicate_of).toBe(existingResult.rows[0].id);
    });

    it('should allow creation when similarity is below threshold', async () => {
      // Create existing analysis
      const hash = generateSimilarityHash({
        task_type: 'dev',
        reason: 'NETWORK',
        root_cause: 'Test: Connection timeout'
      });

      const existingResult = await pool.query(`
        INSERT INTO cortex_analyses (
          root_cause, similarity_hash, analysis_depth, confidence_score, analyst
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, ['Test: Connection timeout', hash, 'deep', 0.8, 'cortex']);

      testAnalysisIds.push(existingResult.rows[0].id);

      // Check with different root cause (low similarity)
      const result = await checkShouldCreateRCA({
        task_type: 'dev',
        reason: 'NETWORK',
        root_cause: 'Test: Completely different issue with DNS resolution failure and database latency'
      });

      expect(result.should_create).toBe(true);
      expect(result.similarity).toBeLessThan(80);
    });
  });

  describe('getQualityStats', () => {
    beforeEach(async () => {
      // Clean all cortex_analyses for clean stats
      await pool.query('DELETE FROM cortex_analyses');
    });

    it('should return stats for given time period', async () => {
      // Create test analyses with quality scores
      const analyses = [
        { score: 85, root_cause: 'Test: Analysis 1' },
        { score: 90, root_cause: 'Test: Analysis 2' },
        { score: 75, root_cause: 'Test: Analysis 3' },
      ];

      for (const a of analyses) {
        const result = await pool.query(`
          INSERT INTO cortex_analyses (
            root_cause, quality_score, analysis_depth, confidence_score, analyst
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `, [a.root_cause, a.score, 'deep', 0.8, 'cortex']);

        testAnalysisIds.push(result.rows[0].id);
      }

      const stats = await getQualityStats(7);

      expect(stats.period_days).toBe(7);
      expect(stats.total_rcas).toBe(3);
      expect(stats.avg_quality_score).toBeGreaterThan(0);
      expect(stats.min_quality_score).toBe(75);
      expect(stats.max_quality_score).toBe(90);
    });

    it('should return zero stats when no analyses exist', async () => {
      const stats = await getQualityStats(7);

      expect(stats.total_rcas).toBe(0);
      expect(stats.avg_quality_score).toBe(0);
    });
  });
});
