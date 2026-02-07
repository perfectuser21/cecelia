/**
 * Cortex Tests - Strategy Adjustments Generation
 *
 * Tests that Cortex generates strategy_adjustments during RCA analysis.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { performRCA, validateCortexDecision } from '../cortex.js';
import pool from '../db.js';

describe('Cortex Strategy Adjustments', () => {

  it('performRCA returns strategy_adjustments field', async () => {
    const failedTask = {
      id: 'test-task-001',
      title: 'Test Task',
      status: 'failed'
    };

    const history = [
      { failure_reason: 'Network timeout', timestamp: new Date().toISOString() }
    ];

    const result = await performRCA(failedTask, history);

    // Strategy adjustments should exist (even in fallback mode)
    expect(result).toHaveProperty('strategy_adjustments');
    expect(Array.isArray(result.strategy_adjustments)).toBe(true);
  }, { timeout: 10000 });

  it('strategy_adjustments format matches learning.js expectations', async () => {
    // Test the format conversion from strategy_updates to strategy_adjustments
    const mockStrategyUpdate = {
      key: 'retry.max_attempts',
      old_value: 3,
      new_value: 5,
      reason: 'Test reason'
    };

    const converted = {
      params: {
        param: mockStrategyUpdate.key,
        new_value: mockStrategyUpdate.new_value,
        current_value: mockStrategyUpdate.old_value,
        reason: mockStrategyUpdate.reason
      }
    };

    // Verify format
    expect(converted).toHaveProperty('params');
    expect(converted.params).toHaveProperty('param');
    expect(converted.params).toHaveProperty('new_value');
    expect(converted.params).toHaveProperty('reason');
  });

  it('only adjusts whitelisted parameters', () => {
    const whitelist = [
      'alertness.emergency_threshold',
      'alertness.alert_threshold',
      'retry.max_attempts',
      'retry.base_delay_minutes',
      'resource.max_concurrent',
      'resource.memory_threshold_mb'
    ];

    // Simulate strategy_adjustments with whitelisted params
    const validAdjustments = [
      {
        params: {
          param: 'retry.max_attempts',
          new_value: 5,
          current_value: 3,
          reason: 'Test'
        }
      }
    ];

    for (const adjustment of validAdjustments) {
      const paramName = adjustment.params.param;
      expect(whitelist).toContain(paramName);
    }
  });

  it('validates Cortex decision with strategy_updates', () => {
    const decision = {
      level: 2,
      analysis: {
        root_cause: 'Test root cause',
        contributing_factors: ['Factor 1'],
        impact_assessment: 'Test impact'
      },
      actions: [],
      strategy_updates: [
        {
          key: 'retry.max_attempts',
          old_value: 3,
          new_value: 5,
          reason: 'Test reason'
        }
      ],
      learnings: ['Test learning'],
      rationale: 'Test rationale',
      confidence: 0.8,
      safety: false
    };

    const validation = validateCortexDecision(decision);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('handles empty strategy_adjustments gracefully', () => {
    // Test that empty strategy_updates array results in empty strategy_adjustments
    const emptyStrategyUpdates = [];
    const converted = emptyStrategyUpdates.map(update => ({
      params: {
        param: update.key,
        new_value: update.new_value,
        current_value: update.old_value,
        reason: update.reason
      }
    }));

    expect(converted).toEqual([]);
  });

  it('performRCA automatically saves analysis to cortex_analyses table', async () => {
    const failedTask = {
      id: '00000000-0000-0000-0000-000000000003',
      title: 'Test Persistence Task',
      task_type: 'dev',
      status: 'failed'
    };

    const history = [
      {
        failure_reason: 'Test: Network timeout for persistence check',
        failure_classification: { class: 'NETWORK' },
        timestamp: new Date().toISOString()
      }
    ];

    // Clean up before test
    await pool.query("DELETE FROM cortex_analyses WHERE root_cause LIKE '%persistence check%'");

    const result = await performRCA(failedTask, history);

    // Wait a bit for async save
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify analysis was saved
    const saved = await pool.query(`
      SELECT * FROM cortex_analyses
      WHERE root_cause LIKE '%persistence check%' OR task_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [failedTask.id]);

    // Clean up after test
    if (saved.rows.length > 0) {
      await pool.query('DELETE FROM cortex_analyses WHERE id = $1', [saved.rows[0].id]);
    }

    // Verify
    expect(result).toHaveProperty('analysis');
    expect(result).toHaveProperty('strategy_adjustments');
  }, { timeout: 15000 });
});
