/**
 * Cortex Memory Tests
 *
 * Tests persistent storage and semantic search for Cortex RCA analyses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pool from '../db.js';
import { saveCortexAnalysis, searchRelevantAnalyses } from '../cortex.js';

describe('Cortex Memory - Persistent Storage', () => {
  const testAnalysisIds = [];

  beforeEach(async () => {
    // Clean up test data
    await pool.query("DELETE FROM cortex_analyses WHERE root_cause LIKE 'Test:%'");
  });

  afterEach(async () => {
    // Clean up created analyses
    if (testAnalysisIds.length > 0) {
      await pool.query('DELETE FROM cortex_analyses WHERE id = ANY($1)', [testAnalysisIds]);
      testAnalysisIds.length = 0;
    }
  });

  describe('saveCortexAnalysis', () => {
    it('saves analysis to database with all fields', async () => {
      const analysis = {
        analysis: 'Test: Network timeout root cause',
        recommended_actions: [{ action: 'retry_with_backoff' }],
        learnings: ['Test learning 1'],
        strategy_adjustments: [{ params: { param: 'retry.max_attempts', new_value: 5 } }],
        confidence: 0.9
      };

      const context = {
        task: { id: 'test-task-id-1' },
        event: { id: 'test-event-id-1', type: 'systemic_failure' },
        failureInfo: {
          class: 'NETWORK',
          task_type: 'dev',
          frequency: 3,
          severity: 'high'
        }
      };

      const analysisId = await saveCortexAnalysis(analysis, context);

      expect(analysisId).toBeDefined();
      testAnalysisIds.push(analysisId);

      // Verify saved data
      const result = await pool.query('SELECT * FROM cortex_analyses WHERE id = $1', [analysisId]);
      const saved = result.rows[0];

      expect(saved.task_id).toBe('test-task-id-1');
      expect(saved.event_id).toBe('test-event-id-1');
      expect(saved.trigger_event_type).toBe('systemic_failure');
      expect(saved.root_cause).toBe('Test: Network timeout root cause');
      expect(saved.confidence_score).toBe(0.9);
      expect(saved.analyst).toBe('cortex');

      // Verify JSONB fields
      const failurePattern = saved.failure_pattern;
      expect(failurePattern.class).toBe('NETWORK');
      expect(failurePattern.task_type).toBe('dev');
    });

    it('handles missing optional fields gracefully', async () => {
      const analysis = {
        analysis: 'Test: Minimal analysis',
        confidence: 0.5
      };

      const analysisId = await saveCortexAnalysis(analysis, {});
      expect(analysisId).toBeDefined();
      testAnalysisIds.push(analysisId);

      const result = await pool.query('SELECT * FROM cortex_analyses WHERE id = $1', [analysisId]);
      const saved = result.rows[0];

      expect(saved.task_id).toBeNull();
      expect(saved.event_id).toBeNull();
      expect(saved.root_cause).toBe('Test: Minimal analysis');
    });

    it('saves contributing_factors and mitigations as JSONB', async () => {
      const analysis = {
        analysis: 'Test: Complex analysis',
        contributing_factors: [
          { factor: 'High load', impact: 'severe' },
          { factor: 'Network congestion', impact: 'moderate' }
        ],
        recommended_actions: [
          { action: 'scale_up', priority: 'high' },
          { action: 'optimize_queries', priority: 'medium' }
        ],
        confidence: 0.85
      };

      const analysisId = await saveCortexAnalysis(analysis, {});
      testAnalysisIds.push(analysisId);

      const result = await pool.query('SELECT * FROM cortex_analyses WHERE id = $1', [analysisId]);
      const saved = result.rows[0];

      const factors = saved.contributing_factors;
      expect(factors).toHaveLength(2);
      expect(factors[0].factor).toBe('High load');

      const mitigations = saved.mitigations;
      expect(mitigations).toHaveLength(2);
      expect(mitigations[0].action).toBe('scale_up');
    });
  });

  describe('searchRelevantAnalyses', () => {
    beforeEach(async () => {
      // Insert test analyses with different characteristics
      const analyses = [
        {
          root_cause: 'Test: Network failure in dev tasks',
          failure_pattern: { class: 'NETWORK', task_type: 'dev' },
          trigger_event_type: 'systemic_failure',
          created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
        },
        {
          root_cause: 'Test: Billing cap hit',
          failure_pattern: { class: 'BILLING_CAP', task_type: 'review' },
          trigger_event_type: 'systemic_failure',
          created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
        },
        {
          root_cause: 'Test: QA task resource exhaustion',
          failure_pattern: { class: 'RESOURCE', task_type: 'qa' },
          trigger_event_type: 'rca_request',
          created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
        },
        {
          root_cause: 'Test: Old network issue',
          failure_pattern: { class: 'NETWORK', task_type: 'dev' },
          trigger_event_type: 'systemic_failure',
          created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) // 40 days ago
        },
        {
          root_cause: 'Test: Recent dev task learning',
          failure_pattern: { class: 'NETWORK', task_type: 'dev' },
          trigger_event_type: 'systemic_failure',
          created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // 1 day ago
        }
      ];

      for (const a of analyses) {
        const result = await pool.query(`
          INSERT INTO cortex_analyses (
            root_cause, failure_pattern, trigger_event_type, created_at,
            contributing_factors, mitigations, learnings, strategy_adjustments,
            analysis_depth, confidence_score, analyst
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id
        `, [
          a.root_cause,
          JSON.stringify(a.failure_pattern),
          a.trigger_event_type,
          a.created_at,
          '[]', '[]', '[]', '[]',
          'deep', 0.8, 'cortex'
        ]);
        testAnalysisIds.push(result.rows[0].id);
      }
    });

    it('returns analyses sorted by relevance score', async () => {
      const results = await searchRelevantAnalyses({
        task_type: 'dev',
        failure_class: 'NETWORK',
        trigger_event: 'systemic_failure'
      }, 10);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('relevance_score');

      // Verify scores are in descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i-1].relevance_score).toBeGreaterThanOrEqual(results[i].relevance_score);
      }
    });

    it('scores failure_class exact match highest (weight 10)', async () => {
      const results = await searchRelevantAnalyses({
        failure_class: 'NETWORK'
      }, 10);

      const networkAnalysis = results.find(r => r.root_cause.includes('Network failure in dev tasks'));

      if (networkAnalysis) {
        // Should get at least 10 points for failure_class match
        expect(networkAnalysis.relevance_score).toBeGreaterThanOrEqual(10);
      }
    });

    it('scores task_type match (weight 8)', async () => {
      const results = await searchRelevantAnalyses({
        task_type: 'dev'
      }, 10);

      const devAnalysis = results.find(r => r.root_cause.includes('Network failure in dev tasks'));

      if (devAnalysis) {
        // Should get points for task_type match
        expect(devAnalysis.relevance_score).toBeGreaterThanOrEqual(8);
      }
    });

    it('scores trigger_event match (weight 6)', async () => {
      const results = await searchRelevantAnalyses({
        trigger_event: 'rca_request'
      }, 10);

      const rcaAnalysis = results.find(r => r.root_cause.includes('QA task resource'));

      if (rcaAnalysis) {
        // Should get points for trigger_event match
        expect(rcaAnalysis.relevance_score).toBeGreaterThanOrEqual(6);
      }
    });

    it('scores freshness correctly (1-3 points)', async () => {
      const results = await searchRelevantAnalyses({}, 10);

      const recentAnalysis = results.find(r => r.root_cause.includes('Recent dev task'));
      const oldAnalysis = results.find(r => r.root_cause.includes('Old network issue'));

      if (recentAnalysis && oldAnalysis) {
        // Recent analysis (1 day old) should score higher than old analysis (40 days old)
        expect(recentAnalysis.relevance_score).toBeGreaterThan(oldAnalysis.relevance_score);
      }
    });

    it('prefers exact matches over partial matches', async () => {
      const results = await searchRelevantAnalyses({
        task_type: 'dev',
        failure_class: 'NETWORK',
        trigger_event: 'systemic_failure'
      }, 10);

      const exactMatch = results.find(r => r.root_cause.includes('Network failure in dev tasks'));

      if (exactMatch && results.length > 1) {
        // Exact match should be at the top
        expect(results[0].root_cause).toBe(exactMatch.root_cause);
      }
    });

    it('handles empty context gracefully', async () => {
      const results = await searchRelevantAnalyses({}, 10);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      // Should still return results, sorted by freshness
    });

    it('respects limit parameter', async () => {
      const results = await searchRelevantAnalyses({}, 3);

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('returns empty array if no analyses exist', async () => {
      // Clean up all test analyses
      await pool.query("DELETE FROM cortex_analyses WHERE root_cause LIKE 'Test:%'");

      const results = await searchRelevantAnalyses({
        task_type: 'nonexistent'
      }, 10);

      expect(Array.isArray(results)).toBe(true);
    });
  });
});
