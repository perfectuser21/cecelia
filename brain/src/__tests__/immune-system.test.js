/**
 * Immune System Module Tests
 *
 * Tests for P0 immune system functionality:
 * - updateFailureSignature()
 * - findActivePolicy()
 * - recordPolicyEvaluation()
 * - shouldPromoteToProbation()
 * - getPolicyEvaluationStats()
 * - shouldPromoteToActive()
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pool from '../db.js';
import {
  updateFailureSignature,
  findActivePolicy,
  findProbationPolicy,
  recordPolicyEvaluation,
  shouldPromoteToProbation,
  getPolicyEvaluationStats,
  shouldPromoteToActive,
  getTopFailureSignatures,
  parsePolicyAction
} from '../immune-system.js';

describe('Immune System Module', () => {
  // Test database setup
  beforeAll(async () => {
    // Ensure test tables exist (run migrations if needed)
    // In real setup, migrations should be run before tests
  });

  afterAll(async () => {
    // Cleanup test data
    await pool.query('DELETE FROM policy_evaluations WHERE signature LIKE \'test%\'');
    await pool.query('DELETE FROM absorption_policies WHERE signature LIKE \'test%\'');
    await pool.query('DELETE FROM failure_signatures WHERE signature LIKE \'test%\'');
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up before each test
    await pool.query('DELETE FROM policy_evaluations WHERE signature LIKE \'test%\'');
    await pool.query('DELETE FROM absorption_policies WHERE signature LIKE \'test%\'');
    await pool.query('DELETE FROM failure_signatures WHERE signature LIKE \'test%\'');
  });

  describe('updateFailureSignature()', () => {
    it('should insert new failure signature', async () => {
      const signature = 'test0123456789ab';
      const failure = {
        run_id: '123e4567-e89b-12d3-a456-426614174000',
        reason_code: 'TEST_ERROR',
        layer: 'L2_executor',
        step_name: 'test_step'
      };

      const result = await updateFailureSignature(signature, failure);

      expect(result).toBeDefined();
      expect(result.signature).toBe(signature);
      expect(result.count_24h).toBe(1);
      expect(result.count_7d).toBe(1);
      expect(result.count_total).toBe(1);
      expect(result.latest_reason_code).toBe('TEST_ERROR');
    });

    it('should increment counts on repeated failures', async () => {
      const signature = 'test0123456789ab';
      const failure = {
        run_id: '123e4567-e89b-12d3-a456-426614174000',
        reason_code: 'TEST_ERROR',
        layer: 'L2_executor',
        step_name: 'test_step'
      };

      // First failure
      await updateFailureSignature(signature, failure);

      // Second failure
      const result = await updateFailureSignature(signature, failure);

      expect(result.count_24h).toBe(2);
      expect(result.count_7d).toBe(2);
      expect(result.count_total).toBe(2);
    });
  });

  describe('findActivePolicy()', () => {
    it('should return null when no active policy exists', async () => {
      const signature = 'test0123456789ab';
      const result = await findActivePolicy(signature);
      expect(result).toBeNull();
    });

    it('should return active policy when one exists', async () => {
      const signature = 'test0123456789ab';

      // Insert active policy
      await pool.query(`
        INSERT INTO absorption_policies (
          signature, status, policy_type, policy_json,
          risk_level, created_by
        ) VALUES ($1, 'active', 'retry', '{"max_retries": 3}'::jsonb, 'low', 'test')
      `, [signature]);

      const result = await findActivePolicy(signature);

      expect(result).toBeDefined();
      expect(result.signature).toBe(signature);
      expect(result.status).toBe('active');
      expect(result.policy_type).toBe('retry');
    });
  });

  describe('findProbationPolicy()', () => {
    it('should return probation policy when one exists', async () => {
      const signature = 'test0123456789ab';

      // Insert probation policy
      await pool.query(`
        INSERT INTO absorption_policies (
          signature, status, policy_type, policy_json,
          risk_level, created_by
        ) VALUES ($1, 'probation', 'backoff', '{"delay_ms": 1000}'::jsonb, 'low', 'test')
      `, [signature]);

      const result = await findProbationPolicy(signature);

      expect(result).toBeDefined();
      expect(result.signature).toBe(signature);
      expect(result.status).toBe('probation');
      expect(result.policy_type).toBe('backoff');
    });
  });

  describe('recordPolicyEvaluation()', () => {
    it('should record policy evaluation with all fields', async () => {
      const signature = 'test0123456789ab';

      // Create policy first
      const policyResult = await pool.query(`
        INSERT INTO absorption_policies (
          signature, status, policy_type, policy_json,
          risk_level, created_by
        ) VALUES ($1, 'active', 'retry', '{}'::jsonb, 'low', 'test')
        RETURNING policy_id
      `, [signature]);

      const policyId = policyResult.rows[0].policy_id;

      // Record evaluation
      const evaluationId = await recordPolicyEvaluation({
        policy_id: policyId,
        run_id: '123e4567-e89b-12d3-a456-426614174000',
        signature: signature,
        mode: 'simulate',
        decision: 'applied',
        verification_result: 'pass',
        latency_ms: 100,
        details: { test: true }
      });

      expect(evaluationId).toBeDefined();

      // Verify record exists
      const result = await pool.query(
        'SELECT * FROM policy_evaluations WHERE evaluation_id = $1',
        [evaluationId]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].mode).toBe('simulate');
      expect(result.rows[0].decision).toBe('applied');
      expect(result.rows[0].verification_result).toBe('pass');
    });
  });

  describe('shouldPromoteToProbation()', () => {
    it('should return false when signature does not exist', async () => {
      const signature = 'test0123456789ab';
      const result = await shouldPromoteToProbation(signature);
      expect(result).toBe(false);
    });

    it('should return true when 24h count >= 2', async () => {
      const signature = 'test0123456789ab';

      // Insert signature with count_24h = 2
      await pool.query(`
        INSERT INTO failure_signatures (
          signature, count_24h, count_7d, count_total
        ) VALUES ($1, 2, 2, 2)
      `, [signature]);

      const result = await shouldPromoteToProbation(signature);
      expect(result).toBe(true);
    });

    it('should return true when 7d count >= 3', async () => {
      const signature = 'test0123456789ab';

      // Insert signature with count_7d = 3
      await pool.query(`
        INSERT INTO failure_signatures (
          signature, count_24h, count_7d, count_total
        ) VALUES ($1, 1, 3, 3)
      `, [signature]);

      const result = await shouldPromoteToProbation(signature);
      expect(result).toBe(true);
    });

    it('should return false when counts are below threshold', async () => {
      const signature = 'test0123456789ab';

      // Insert signature with low counts
      await pool.query(`
        INSERT INTO failure_signatures (
          signature, count_24h, count_7d, count_total
        ) VALUES ($1, 1, 1, 1)
      `, [signature]);

      const result = await shouldPromoteToProbation(signature);
      expect(result).toBe(false);
    });
  });

  describe('getPolicyEvaluationStats()', () => {
    it('should return correct statistics', async () => {
      const signature = 'test0123456789ab';

      // Create policy
      const policyResult = await pool.query(`
        INSERT INTO absorption_policies (
          signature, status, policy_type, policy_json,
          risk_level, created_by
        ) VALUES ($1, 'probation', 'retry', '{}'::jsonb, 'low', 'test')
        RETURNING policy_id
      `, [signature]);

      const policyId = policyResult.rows[0].policy_id;

      // Add evaluations
      await recordPolicyEvaluation({
        policy_id: policyId,
        signature: signature,
        mode: 'simulate',
        decision: 'applied',
        verification_result: 'pass'
      });

      await recordPolicyEvaluation({
        policy_id: policyId,
        signature: signature,
        mode: 'simulate',
        decision: 'applied',
        verification_result: 'pass'
      });

      await recordPolicyEvaluation({
        policy_id: policyId,
        signature: signature,
        mode: 'simulate',
        decision: 'applied',
        verification_result: 'fail'
      });

      // Get stats
      const stats = await getPolicyEvaluationStats(policyId);

      expect(stats.total_evaluations).toBe('3');
      expect(stats.simulations).toBe('3');
      expect(stats.applied).toBe('3');
      expect(stats.verified_pass).toBe('2');
      expect(stats.verified_fail).toBe('1');
      expect(parseFloat(stats.success_rate)).toBeCloseTo(66.7, 0);
    });
  });

  describe('shouldPromoteToActive()', () => {
    it('should return false when simulation count < 2', async () => {
      const signature = 'test0123456789ab';

      // Create policy with only 1 simulation
      const policyResult = await pool.query(`
        INSERT INTO absorption_policies (
          signature, status, policy_type, policy_json,
          risk_level, created_by
        ) VALUES ($1, 'probation', 'retry', '{}'::jsonb, 'low', 'test')
        RETURNING policy_id
      `, [signature]);

      const policyId = policyResult.rows[0].policy_id;

      await recordPolicyEvaluation({
        policy_id: policyId,
        signature: signature,
        mode: 'simulate',
        decision: 'applied',
        verification_result: 'pass'
      });

      const result = await shouldPromoteToActive(policyId);
      expect(result).toBe(false);
    });

    it('should return true when criteria met: simulations >= 2 and success_rate >= 90%', async () => {
      const signature = 'test0123456789ab';

      // Create policy
      const policyResult = await pool.query(`
        INSERT INTO absorption_policies (
          signature, status, policy_type, policy_json,
          risk_level, created_by
        ) VALUES ($1, 'probation', 'retry', '{}'::jsonb, 'low', 'test')
        RETURNING policy_id
      `, [signature]);

      const policyId = policyResult.rows[0].policy_id;

      // Add 2 successful simulations
      await recordPolicyEvaluation({
        policy_id: policyId,
        signature: signature,
        mode: 'simulate',
        decision: 'applied',
        verification_result: 'pass'
      });

      await recordPolicyEvaluation({
        policy_id: policyId,
        signature: signature,
        mode: 'simulate',
        decision: 'applied',
        verification_result: 'pass'
      });

      const result = await shouldPromoteToActive(policyId);
      expect(result).toBe(true);
    });
  });

  describe('getTopFailureSignatures()', () => {
    it('should return top signatures ordered by 24h count', async () => {
      // Insert multiple signatures
      await pool.query(`
        INSERT INTO failure_signatures (signature, count_24h, count_7d, count_total, latest_reason_code)
        VALUES
          ('test1234567890ab', 5, 10, 20, 'ERROR_A'),
          ('test2345678901ab', 3, 8, 15, 'ERROR_B'),
          ('test3456789012ab', 1, 5, 10, 'ERROR_C')
      `);

      const results = await getTopFailureSignatures(2);

      expect(results.length).toBe(2);
      expect(results[0].signature).toBe('test1234567890ab');
      expect(results[0].count_24h).toBe(5);
      expect(results[1].signature).toBe('test2345678901ab');
      expect(results[1].count_24h).toBe(3);
    });
  });

  describe('parsePolicyAction() - P1', () => {
    it('should parse complete policy_json', () => {
      const policyJson = {
        action: 'requeue',
        params: { delay_minutes: 30, priority: 'low' },
        expected_outcome: 'Task will retry after 30 min with lower priority'
      };

      const result = parsePolicyAction(policyJson);

      expect(result.type).toBe('requeue');
      expect(result.params).toEqual({ delay_minutes: 30, priority: 'low' });
      expect(result.expected_outcome).toBe('Task will retry after 30 min with lower priority');
    });

    it('should handle missing fields with defaults', () => {
      const policyJson = {
        action: 'skip'
        // Missing params and expected_outcome
      };

      const result = parsePolicyAction(policyJson);

      expect(result.type).toBe('skip');
      expect(result.params).toEqual({});
      expect(result.expected_outcome).toBe('No expected outcome defined');
    });

    it('should handle null/undefined input', () => {
      const result1 = parsePolicyAction(null);
      const result2 = parsePolicyAction(undefined);

      expect(result1.type).toBe('unknown');
      expect(result1.params).toEqual({});
      expect(result1.expected_outcome).toBe('No policy JSON provided');

      expect(result2.type).toBe('unknown');
    });

    it('should parse JSON string', () => {
      const policyJsonString = JSON.stringify({
        action: 'adjust_params',
        params: { timeout: 60 },
        expected_outcome: 'Increase timeout to 60s'
      });

      const result = parsePolicyAction(policyJsonString);

      expect(result.type).toBe('adjust_params');
      expect(result.params.timeout).toBe(60);
    });

    it('should handle invalid JSON gracefully', () => {
      const invalidJson = '{invalid json}';

      const result = parsePolicyAction(invalidJson);

      expect(result.type).toBe('parse_error');
      expect(result.params).toEqual({});
      expect(result.expected_outcome).toContain('Failed to parse policy JSON');
    });
  });
});
