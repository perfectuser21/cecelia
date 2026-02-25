/**
 * Learning Loop Tests
 *
 * Tests the Brain self-learning closed loop system.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pool from '../db.js';
import {
  recordLearning,
  applyStrategyAdjustments,
  getRecentLearnings,
  shouldTriggerLearning,
  createLearningTask,
  ADJUSTABLE_PARAMS,
} from '../learning.js';

describe('Learning Loop', () => {
  beforeAll(async () => {
    // Ensure learnings table exists
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
        metadata JSONB
      )
    `);

    // Ensure brain_config has metadata column
    await pool.query(`
      ALTER TABLE brain_config ADD COLUMN IF NOT EXISTS metadata JSONB
    `);

    // Clean up test data
    await pool.query("DELETE FROM learnings WHERE title LIKE 'Test%' OR title LIKE 'RCA Learning:%'");
    await pool.query("DELETE FROM tasks WHERE title LIKE 'Learning -%'");
    await pool.query("DELETE FROM brain_config WHERE key LIKE 'test.%'");
    await pool.query("DELETE FROM brain_config WHERE key = 'alertness.emergency_threshold'");
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query("DELETE FROM learnings WHERE title LIKE 'Test%' OR title LIKE 'RCA Learning:%'");
    await pool.query("DELETE FROM tasks WHERE title LIKE 'Learning -%'");
    await pool.query("DELETE FROM brain_config WHERE key LIKE 'test.%'");
  });

  describe('recordLearning', () => {
    it('should record learning from Cortex RCA analysis', async () => {
      const analysis = {
        task_id: 'test-task-123',
        analysis: {
          root_cause: 'High concurrent task load causing resource exhaustion',
          contributing_factors: ['Failed task retries', 'CPU pressure'],
          impact_assessment: 'System performance degraded',
        },
        recommended_actions: [
          { type: 'pause_p2_tasks', params: {} },
          { type: 'adjust_strategy', params: { param: 'alertness.emergency_threshold', new_value: 0.8, old_value: 0.9, reason: 'Lower threshold for earlier detection' } },
        ],
        learnings: ['Resource limits should be more conservative'],
        confidence: 0.85,
      };

      const learning = await recordLearning(analysis);

      expect(learning).toBeDefined();
      expect(learning.id).toBeDefined();
      expect(learning.title).toContain('RCA Learning:');
      expect(learning.category).toBe('failure_pattern');
      expect(learning.trigger_event).toBe('systemic_failure');
      expect(learning.applied).toBe(false);

      const parsedContent = JSON.parse(learning.content);
      expect(parsedContent.root_cause).toBe('High concurrent task load causing resource exhaustion');
      expect(parsedContent.learnings).toEqual(['Resource limits should be more conservative']);
    });
  });

  describe('applyStrategyAdjustments', () => {
    it('should apply valid strategy adjustments to brain_config', async () => {
      const learningId = 'test-learning-id';
      const adjustments = [
        {
          type: 'adjust_strategy',
          params: {
            param: 'alertness.emergency_threshold',
            old_value: 0.9,
            new_value: 0.8,
            reason: 'Lower threshold for earlier detection',
          },
        },
      ];

      const result = await applyStrategyAdjustments(adjustments, learningId);

      expect(result.applied).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);

      // Verify brain_config was updated
      const configResult = await pool.query(
        'SELECT value, metadata FROM brain_config WHERE key = $1',
        ['alertness.emergency_threshold']
      );

      expect(configResult.rows.length).toBeGreaterThan(0);
      expect(JSON.parse(configResult.rows[0].value)).toBe(0.8);
      expect(configResult.rows[0].metadata.learning_id).toBe(learningId);
    });

    it('should skip adjustments not in whitelist', async () => {
      const adjustments = [
        {
          type: 'adjust_strategy',
          params: {
            param: 'dangerous.param',
            new_value: 999,
          },
        },
      ];

      const result = await applyStrategyAdjustments(adjustments, null);

      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].reason).toBe('param_not_whitelisted');
    });

    it('should skip adjustments with values out of range', async () => {
      const adjustments = [
        {
          type: 'adjust_strategy',
          params: {
            param: 'alertness.emergency_threshold',
            old_value: 0.9,
            new_value: 1.5,  // Out of range (max 1.0)
            reason: 'Test',
          },
        },
      ];

      const result = await applyStrategyAdjustments(adjustments, null);

      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].reason).toContain('value_out_of_range');
    });
  });

  describe('getRecentLearnings', () => {
    beforeAll(async () => {
      // Insert test learnings
      await pool.query(`
        INSERT INTO learnings (title, category, trigger_event, content)
        VALUES
          ('Test Learning 1', 'failure_pattern', 'systemic_failure', 'Content 1'),
          ('Test Learning 2', 'optimization', 'performance_issue', 'Content 2')
      `);
    });

    it('should retrieve recent learnings', async () => {
      const learnings = await getRecentLearnings(null, 10);

      expect(learnings.length).toBeGreaterThan(0);
      expect(learnings[0]).toHaveProperty('id');
      expect(learnings[0]).toHaveProperty('title');
      expect(learnings[0]).toHaveProperty('category');
    });

    it('should filter by category', async () => {
      const learnings = await getRecentLearnings('failure_pattern', 5);

      expect(learnings.length).toBeGreaterThan(0);
      learnings.forEach(learning => {
        expect(learning.category).toBe('failure_pattern');
      });
    });
  });

  describe('shouldTriggerLearning', () => {
    it('should trigger for systemic failures', () => {
      const failureInfo = { is_systemic: true };
      expect(shouldTriggerLearning(failureInfo)).toBe(true);
    });

    it('should not trigger for individual task errors', () => {
      const failureInfo = { is_systemic: false };
      expect(shouldTriggerLearning(failureInfo)).toBe(false);
    });
  });

  describe('createLearningTask', () => {
    it('should create learning task with correct payload', async () => {
      const failureContext = {
        trigger: 'systemic_failure',
        failures: [{ id: 1 }, { id: 2 }],
        signals: { active_tasks: 10, failed_tasks: 3 },
      };

      const taskId = await createLearningTask(failureContext);

      expect(taskId).toBeDefined();

      // Verify task was created
      const taskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
      const task = taskResult.rows[0];

      expect(task.title).toContain('Learning -');
      expect(task.task_type).toBe('research');
      expect(task.priority).toBe('P1');
      expect(task.payload.requires_cortex).toBe(true);
      expect(task.payload.requires_learning).toBe(true);
    });
  });

  describe('ADJUSTABLE_PARAMS whitelist', () => {
    it('should have valid whitelist configuration', () => {
      expect(ADJUSTABLE_PARAMS).toBeDefined();
      expect(Object.keys(ADJUSTABLE_PARAMS).length).toBeGreaterThan(0);

      Object.entries(ADJUSTABLE_PARAMS).forEach(([param, config]) => {
        expect(config).toHaveProperty('min');
        expect(config).toHaveProperty('max');
        expect(config).toHaveProperty('type');
        expect(config.min).toBeLessThan(config.max);
      });
    });
  });
});
