/**
 * Learning Search API Tests
 *
 * Tests the Learning retrieval API functionality.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../db.js';
import { searchLearnings, recordLearning } from '../learning.js';

describe('Learning Search API', () => {
  let testLearningIds = [];

  beforeAll(async () => {
    // Ensure learnings table exists with quality_score column
    await pool.query(`
      CREATE TABLE IF NOT EXISTS learnings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        category VARCHAR(50),
        trigger_event VARCHAR(100),
        content TEXT,
        strategy_adjustments JSONB,
        applied BOOLEAN DEFAULT false,
        applied_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        metadata JSONB,
        quality_score FLOAT,
        effectiveness_score DOUBLE PRECISION
      )
    `);

    // Add quality_score column if not exists
    await pool.query(`
      ALTER TABLE learnings ADD COLUMN IF NOT EXISTS quality_score FLOAT
    `);

    // Clean up test data
    await pool.query("DELETE FROM learnings WHERE title LIKE 'SearchTest%'");

    // Create test learnings with different attributes
    const testLearnings = [
      {
        title: 'SearchTest - Network Failure Pattern',
        category: 'failure_pattern',
        trigger_event: 'systemic_failure',
        content: 'Network timeout issues caused by high latency',
        quality_score: 0.8,
      },
      {
        title: 'SearchTest - Resource Optimization',
        category: 'optimization',
        trigger_event: 'performance_issue',
        content: 'Memory usage optimization strategies',
        quality_score: 0.6,
      },
      {
        title: 'SearchTest - Strategy Adjustment',
        category: 'strategy_adjustment',
        trigger_event: 'configuration_change',
        content: 'Retry mechanism improvements',
        quality_score: 0.9,
      },
    ];

    for (const learning of testLearnings) {
      const result = await pool.query(`
        INSERT INTO learnings (title, category, trigger_event, content, quality_score)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [learning.title, learning.category, learning.trigger_event, learning.content, learning.quality_score]);
      testLearningIds.push(result.rows[0].id);
    }
  });

  afterAll(async () => {
    // Clean up test data
    if (testLearningIds.length > 0) {
      await pool.query(`DELETE FROM learnings WHERE id = ANY($1)`, [testLearningIds]);
    }
  });

  describe('searchLearnings', () => {
    it('should return all learnings without filters', async () => {
      const result = await searchLearnings({});

      expect(result.data).toBeDefined();
      expect(result.pagination).toBeDefined();
      expect(result.pagination.total).toBeGreaterThan(0);
    });

    it('should filter by keyword', async () => {
      const result = await searchLearnings({ keyword: 'Network' });

      expect(result.data).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].title).toContain('Network');
    });

    it('should filter by type/category', async () => {
      const result = await searchLearnings({ type: 'failure_pattern' });

      expect(result.data).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].category).toBe('failure_pattern');
    });

    it('should filter by minimum quality score', async () => {
      const result = await searchLearnings({ min_quality_score: 0.7 });

      expect(result.data).toBeDefined();
      for (const learning of result.data) {
        if (learning.quality_score !== null) {
          expect(learning.quality_score).toBeGreaterThanOrEqual(0.7);
        }
      }
    });

    it('should support pagination with limit and offset', async () => {
      const result1 = await searchLearnings({ limit: 2, offset: 0 });
      const result2 = await searchLearnings({ limit: 2, offset: 2 });

      expect(result1.data.length).toBeLessThanOrEqual(2);
      expect(result1.pagination.has_more).toBeDefined();
      // Different results expected with offset
      expect(result2.pagination.offset).toBe(2);
    });

    it('should filter by date range', async () => {
      const today = new Date().toISOString();
      const result = await searchLearnings({ from_date: '2020-01-01', to_date: today });

      expect(result.data).toBeDefined();
      expect(result.pagination.total).toBeGreaterThan(0);
    });

    it('should combine multiple filters', async () => {
      const result = await searchLearnings({
        keyword: 'SearchTest',
        type: 'failure_pattern',
        min_quality_score: 0.5,
      });

      expect(result.data).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].category).toBe('failure_pattern');
    });

    it('should return pagination metadata', async () => {
      const result = await searchLearnings({ limit: 10, offset: 0 });

      expect(result.pagination).toHaveProperty('total');
      expect(result.pagination).toHaveProperty('limit');
      expect(result.pagination).toHaveProperty('offset');
      expect(result.pagination).toHaveProperty('has_more');
    });
  });
});
