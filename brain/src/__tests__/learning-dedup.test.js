/**
 * Learning Deduplication and Versioning Tests
 *
 * Tests for content hash deduplication, version management, and merging similar learnings.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../db.js';
import {
  recordLearning,
  recordLearningWithDedup,
  generateContentHash,
  mergeSimilarLearnings,
  findSimilarLearnings,
} from '../learning.js';

describe('Learning Deduplication and Versioning', () => {
  beforeAll(async () => {
    // Ensure learnings table has new columns (run migration if needed)
    try {
      await pool.query(`
        ALTER TABLE learnings ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)
      `);
      await pool.query(`
        ALTER TABLE learnings ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1
      `);
      await pool.query(`
        ALTER TABLE learnings ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES learnings(id)
      `);
      await pool.query(`
        ALTER TABLE learnings ADD COLUMN IF NOT EXISTS is_latest BOOLEAN DEFAULT true
      `);
    } catch (e) {
      // Columns may already exist
    }

    // Clean up test data
    await pool.query("DELETE FROM learnings WHERE title LIKE 'Test Dedup%' OR title LIKE '[MERGED]%'");
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query("DELETE FROM learnings WHERE title LIKE 'Test Dedup%' OR title LIKE '[MERGED]%'");
  });

  describe('generateContentHash', () => {
    it('should generate consistent SHA-256 hash for same content', () => {
      const data = { root_cause: 'test', factors: ['a', 'b'] };
      const hash1 = generateContentHash(data);
      const hash2 = generateContentHash(data);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 = 64 hex chars
    });

    it('should generate different hash for different content', () => {
      const hash1 = generateContentHash({ a: 1 });
      const hash2 = generateContentHash({ a: 2 });

      expect(hash1).not.toBe(hash2);
    });

    it('should handle string input', () => {
      const hash = generateContentHash('test string');
      expect(hash).toHaveLength(64);
    });
  });

  describe('recordLearningWithDedup', () => {
    it('should create new learning when no duplicate exists', async () => {
      const analysis = {
        task_id: 'test-dedup-1',
        analysis: {
          root_cause: 'Test root cause unique',
          contributing_factors: ['Factor A'],
        },
        recommended_actions: [],
        learnings: ['Learning point 1'],
        confidence: 0.9,
      };

      const result = await recordLearningWithDedup(analysis);

      expect(result.isNew).toBe(true);
      expect(result.isDuplicate).toBe(false);
      expect(result.learning).toBeDefined();
      expect(result.learning.version).toBe(1);
      expect(result.learning.content_hash).toBeDefined();
    });

    it('should detect duplicate and create new version when enabled', async () => {
      const analysis = {
        task_id: 'test-dedup-2',
        analysis: {
          root_cause: 'Test root cause for versioning',
          contributing_factors: ['Factor B'],
        },
        recommended_actions: [
          { type: 'adjust_strategy', params: { param: 'retry.max_attempts', new_value: 3 } }
        ],
        learnings: ['Learning point 2'],
        confidence: 0.8,
      };

      // First call - create original
      const result1 = await recordLearningWithDedup(analysis, { enableDedup: true, enableVersioning: true });
      expect(result1.isNew).toBe(true);
      expect(result1.learning.version).toBe(1);

      // Second call with same content - should create new version
      const result2 = await recordLearningWithDedup(analysis, { enableDedup: true, enableVersioning: true });
      expect(result2.isDuplicate).toBe(true);
      expect(result2.isVersionUpdate).toBe(true);
      expect(result2.learning.version).toBe(2);
      expect(result2.previousVersion.id).toBe(result1.learning.id);
    });

    it('should return existing learning when versioning disabled', async () => {
      const analysis = {
        task_id: 'test-dedup-3',
        analysis: {
          root_cause: 'Test root cause no versioning',
          contributing_factors: ['Factor C'],
        },
        recommended_actions: [],
        learnings: ['Learning point 3'],
        confidence: 0.7,
      };

      // First call
      const result1 = await recordLearningWithDedup(analysis, { enableDedup: true, enableVersioning: true });
      const originalId = result1.learning.id;

      // Second call with versioning disabled - should return existing
      const result2 = await recordLearningWithDedup(analysis, { enableDedup: true, enableVersioning: false });

      expect(result2.isDuplicate).toBe(true);
      expect(result2.isVersionUpdate).toBe(false);
      expect(result2.learning.id).toBe(originalId);
    });
  });

  describe('mergeSimilarLearnings', () => {
    it('should merge multiple learnings into new version', async () => {
      // Create two learnings to merge
      const analysis1 = {
        task_id: 'test-merge-1',
        analysis: {
          root_cause: 'Memory leak in task queue',
          contributing_factors: ['Unreleased event listeners'],
        },
        recommended_actions: [],
        learnings: ['Clean up listeners'],
        confidence: 0.9,
      };

      const analysis2 = {
        task_id: 'test-merge-2',
        analysis: {
          root_cause: 'Memory leak in connection pool',
          contributing_factors: ['Unreleased database connections'],
        },
        recommended_actions: [],
        learnings: ['Close connections properly'],
        confidence: 0.85,
      };

      const result1 = await recordLearning(analysis1);
      const result2 = await recordLearning(analysis2);

      // Merge them
      const mergeResult = await mergeSimilarLearnings(result1.id, [result2.id]);

      expect(mergeResult.newMergedLearning).toBeDefined();
      expect(mergeResult.merged).toContain(result2.id);

      // Verify version was incremented
      const mergedContent = JSON.parse(mergeResult.newMergedLearning.content);
      expect(mergedContent.merged_from).toContain(result1.id);
      expect(mergedContent.merged_from).toContain(result2.id);
    });

    it('should throw error for invalid input', async () => {
      await expect(
        mergeSimilarLearnings(null, [])
      ).rejects.toThrow();

      await expect(
        mergeSimilarLearnings('invalid-uuid', [])
      ).rejects.toThrow();
    });
  });

  describe('findSimilarLearnings', () => {
    it('should find similar learnings by content', async () => {
      // Create learnings with similar content
      const analysis1 = {
        task_id: 'test-similar-1',
        analysis: {
          root_cause: 'Network timeout during API call',
          contributing_factors: ['Slow response time', 'High latency'],
        },
        recommended_actions: [],
        learnings: ['Add timeout handling'],
        confidence: 0.8,
      };

      const analysis2 = {
        task_id: 'test-similar-2',
        analysis: {
          root_cause: 'Network error in request handler',
          contributing_factors: ['Connection reset', 'Network issues'],
        },
        recommended_actions: [],
        learnings: ['Implement retry logic'],
        confidence: 0.75,
      };

      const result1 = await recordLearning(analysis1);
      await recordLearning(analysis2);

      // Find similar to result1
      const similar = await findSimilarLearnings(result1.id, 0.3, 5);

      expect(Array.isArray(similar)).toBe(true);
    });

    it('should throw error for non-existent learning', async () => {
      await expect(
        findSimilarLearnings('00000000-0000-0000-0000-000000000000', 0.5, 5)
      ).rejects.toThrow();
    });
  });
});
