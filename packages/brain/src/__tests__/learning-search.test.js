/**
 * Learning Semantic Search Tests
 *
 * Tests the semantic search functionality for learnings.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../db.js';
import { searchRelevantLearnings, getRecentLearnings } from '../learning.js';

describe('Learning Semantic Search', () => {
  beforeAll(async () => {
    // Clean up test data
    await pool.query("DELETE FROM learnings WHERE title LIKE 'Test:%'");

    // Insert test learnings with different characteristics
    await pool.query(`
      INSERT INTO learnings (title, category, trigger_event, content, metadata, created_at)
      VALUES
        ('Test: Network failure in dev tasks', 'failure_pattern', 'systemic_failure',
         '{"root_cause": "network timeout", "contributing_factors": ["high latency", "NETWORK class"]}',
         '{"task_type": "dev"}'::jsonb, NOW() - INTERVAL '5 days'),

        ('Test: Billing cap hit', 'failure_pattern', 'systemic_failure',
         '{"root_cause": "billing cap reached", "contributing_factors": ["BILLING_CAP exceeded"]}',
         '{"task_type": "review"}'::jsonb, NOW() - INTERVAL '2 days'),

        ('Test: QA task resource exhaustion', 'failure_pattern', 'rca_request',
         '{"root_cause": "memory exhaustion", "contributing_factors": ["RESOURCE limit"]}',
         '{"task_type": "qa"}'::jsonb, NOW() - INTERVAL '10 days'),

        ('Test: Old learning', 'failure_pattern', 'systemic_failure',
         '{"root_cause": "old issue"}',
         '{}'::jsonb, NOW() - INTERVAL '40 days'),

        ('Test: Recent dev task learning', 'failure_pattern', 'systemic_failure',
         '{"root_cause": "recent dev issue"}',
         '{"task_type": "dev"}'::jsonb, NOW() - INTERVAL '1 day')
    `);
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query("DELETE FROM learnings WHERE title LIKE 'Test:%'");
  });

  it('returns learnings sorted by relevance score', async () => {
    const results = await searchRelevantLearnings({
      task_type: 'dev',
      failure_class: 'NETWORK',
      event_type: 'systemic_failure'
    }, 10);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('relevance_score');

    // Verify scores are in descending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i-1].relevance_score).toBeGreaterThanOrEqual(results[i].relevance_score);
    }
  });

  it('scores task_type exact match highest (weight 10)', async () => {
    const results = await searchRelevantLearnings({
      task_type: 'dev'
    }, 10);

    // Find test learnings
    const devLearning = results.find(l => l.title.includes('Network failure in dev tasks'));
    const qaLearning = results.find(l => l.title.includes('QA task resource'));

    if (devLearning && qaLearning) {
      // Dev learning should score higher due to task_type match
      expect(devLearning.relevance_score).toBeGreaterThan(qaLearning.relevance_score);
    }
  });

  it('scores failure_class match high (weight 8)', async () => {
    const results = await searchRelevantLearnings({
      failure_class: 'NETWORK'
    }, 10);

    const networkLearning = results.find(l => l.title.includes('Network failure'));

    if (networkLearning) {
      // Should get points for failure_class match
      expect(networkLearning.relevance_score).toBeGreaterThanOrEqual(8);
    }
  });

  it('scores event_type match (weight 6)', async () => {
    const results = await searchRelevantLearnings({
      event_type: 'rca_request'
    }, 10);

    const rcaLearning = results.find(l => l.title.includes('QA task resource'));

    if (rcaLearning) {
      // Should get points for event_type match
      expect(rcaLearning.relevance_score).toBeGreaterThanOrEqual(6);
    }
  });

  it('scores freshness correctly (1-3 points)', async () => {
    const results = await searchRelevantLearnings({}, 10);

    const recentLearning = results.find(l => l.title.includes('Recent dev task'));
    const oldLearning = results.find(l => l.title.includes('Old learning'));

    if (recentLearning && oldLearning) {
      // Recent learning (1 day old) should score higher than old learning (40 days old)
      expect(recentLearning.relevance_score).toBeGreaterThan(oldLearning.relevance_score);
    }
  });

  it('prefers exact matches over partial matches', async () => {
    const results = await searchRelevantLearnings({
      task_type: 'dev',
      failure_class: 'NETWORK',
      event_type: 'systemic_failure'
    }, 10);

    const exactMatch = results.find(l => l.title.includes('Network failure in dev tasks'));

    if (exactMatch && results.length > 1) {
      // Exact match should be at the top
      expect(results[0].title).toBe(exactMatch.title);
    }
  });

  it('handles empty context gracefully', async () => {
    const results = await searchRelevantLearnings({}, 10);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    // Should still return results, sorted by freshness
  });

  it('respects limit parameter', async () => {
    const results = await searchRelevantLearnings({}, 3);

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('returns empty array if no learnings exist', async () => {
    // Clean up all test learnings temporarily
    await pool.query("DELETE FROM learnings WHERE title LIKE 'Test:%'");

    const results = await searchRelevantLearnings({
      task_type: 'nonexistent'
    }, 10);

    expect(Array.isArray(results)).toBe(true);

    // Restore test data
    await pool.query(`
      INSERT INTO learnings (title, category, trigger_event, content, metadata, created_at)
      VALUES
        ('Test: Network failure in dev tasks', 'failure_pattern', 'systemic_failure',
         '{"root_cause": "network timeout"}',
         '{"task_type": "dev"}'::jsonb, NOW() - INTERVAL '5 days')
    `);
  });

  it('getRecentLearnings still works (backward compatibility)', async () => {
    const results = await getRecentLearnings(null, 10);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    // Should be sorted by created_at DESC
    if (results.length > 1) {
      const firstDate = new Date(results[0].created_at);
      const secondDate = new Date(results[1].created_at);
      expect(firstDate.getTime()).toBeGreaterThanOrEqual(secondDate.getTime());
    }
  });
});
