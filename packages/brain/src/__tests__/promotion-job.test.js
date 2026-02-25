/**
 * Tests for promotion-job.js (P1)
 *
 * Coverage:
 * - countPromotionsToday()
 * - findPromotionCandidates()
 * - promoteToActive()
 * - findPoliciesToDisable()
 * - disablePolicy()
 * - runPromotionJob() integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import pool from '../db.js';
import {
  runPromotionJob,
  countPromotionsToday,
  findPromotionCandidates,
  promoteToActive,
  findPoliciesToDisable,
  disablePolicy
} from '../promotion-job.js';

describe('Promotion Job (P1)', () => {
  beforeEach(async () => {
    // Clean up all related tables
    await pool.query('DELETE FROM policy_evaluations');
    await pool.query('DELETE FROM absorption_policies');
    await pool.query('DELETE FROM failure_signatures');
  });

  describe('countPromotionsToday()', () => {
    it('should return 0 when no promotions', async () => {
      const count = await countPromotionsToday();
      expect(count).toBe(0);
    });

    it('should count only promote mode evaluations', async () => {
      // Insert test policy
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'active', 'requeue', '{}', 'low', 'test')
      `);

      // Insert evaluations (mixed modes)
      await pool.query(`
        INSERT INTO policy_evaluations (policy_id, signature, mode, decision, created_at)
        VALUES
          ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'promote', 'applied', NOW() - INTERVAL '1 hour'),
          ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'simulate', 'applied', NOW() - INTERVAL '1 hour'),
          ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'promote', 'applied', NOW() - INTERVAL '2 hours')
      `);

      const count = await countPromotionsToday();
      expect(count).toBe(2); // Only 'promote' mode
    });

    it('should not count promotions older than 24 hours', async () => {
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'active', 'requeue', '{}', 'low', 'test')
      `);

      await pool.query(`
        INSERT INTO policy_evaluations (policy_id, signature, mode, decision, created_at)
        VALUES
          ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'promote', 'applied', NOW() - INTERVAL '25 hours'),
          ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'promote', 'applied', NOW() - INTERVAL '1 hour')
      `);

      const count = await countPromotionsToday();
      expect(count).toBe(1); // Only recent one
    });
  });

  describe('findPromotionCandidates()', () => {
    it('should find qualifying probation policy', async () => {
      // Create probation policy
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'probation', 'requeue', '{}', 'low', 'test')
      `);

      // Insert evaluations (2 simulates, 2 pass, 0 fail = 100%)
      await pool.query(`
        INSERT INTO policy_evaluations (policy_id, signature, mode, decision, verification_result)
        VALUES
          ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'simulate', 'applied', 'pass'),
          ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'simulate', 'applied', 'pass')
      `);

      const candidates = await findPromotionCandidates(10);

      expect(candidates.length).toBe(1);
      expect(candidates[0].policy_id).toBe('00000000-0000-0000-0000-000000000001');
      expect(candidates[0].simulate_count).toBe(2);
      expect(candidates[0].pass_count).toBe(2);
      expect(candidates[0].fail_count).toBe(0);
    });

    it('should respect 90% pass rate threshold', async () => {
      // Create two policies
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES
          ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'probation', 'requeue', '{}', 'low', 'test'),
          ('00000000-0000-0000-0000-000000000002'::UUID, 'test2345678901ab', 'probation', 'requeue', '{}', 'low', 'test')
      `);

      // Policy 1: 9/10 = 90% (should qualify)
      await pool.query(`
        INSERT INTO policy_evaluations (policy_id, signature, mode, decision, verification_result)
        SELECT '00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'simulate', 'applied', 'pass'
        FROM generate_series(1, 9)
        UNION ALL
        SELECT '00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'simulate', 'applied', 'fail'
      `);

      // Policy 2: 8/10 = 80% (should not qualify)
      await pool.query(`
        INSERT INTO policy_evaluations (policy_id, signature, mode, decision, verification_result)
        SELECT '00000000-0000-0000-0000-000000000002'::UUID, 'test2345678901ab', 'simulate', 'applied', 'pass'
        FROM generate_series(1, 8)
        UNION ALL
        SELECT '00000000-0000-0000-0000-000000000002'::UUID, 'test2345678901ab', 'simulate', 'applied', 'fail'
        FROM generate_series(1, 2)
      `);

      const candidates = await findPromotionCandidates(10);

      expect(candidates.length).toBe(1);
      expect(candidates[0].policy_id).toBe('00000000-0000-0000-0000-000000000001');
    });

    it('should only select low risk policies', async () => {
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES
          ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'probation', 'requeue', '{}', 'low', 'test'),
          ('00000000-0000-0000-0000-000000000002'::UUID, 'test2345678901ab', 'probation', 'requeue', '{}', 'medium', 'test')
      `);

      // Both have same stats
      for (const policyId of ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002']) {
        await pool.query(`
          INSERT INTO policy_evaluations (policy_id, signature, mode, decision, verification_result)
          SELECT $1, 'test', 'simulate', 'applied', 'pass'
          FROM generate_series(1, 2)
        `, [policyId]);
      }

      const candidates = await findPromotionCandidates(10);

      expect(candidates.length).toBe(1);
      expect(candidates[0].risk_level).toBe('low');
    });

    it('should require at least 2 simulations', async () => {
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'probation', 'requeue', '{}', 'low', 'test')
      `);

      // Only 1 simulation
      await pool.query(`
        INSERT INTO policy_evaluations (policy_id, signature, mode, decision, verification_result)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'simulate', 'applied', 'pass')
      `);

      const candidates = await findPromotionCandidates(10);
      expect(candidates.length).toBe(0);
    });

    it('should respect limit parameter', async () => {
      // Create 5 qualifying policies
      for (let i = 1; i <= 5; i++) {
        const policyId = `00000000-0000-0000-0000-00000000000${i}`;
        const signature = `test${i}234567890ab`;

        await pool.query(`
          INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
          VALUES ($1, $2, 'probation', 'requeue', '{}', 'low', 'test')
        `, [policyId, signature]);

        await pool.query(`
          INSERT INTO policy_evaluations (policy_id, signature, mode, decision, verification_result)
          SELECT $1, $2, 'simulate', 'applied', 'pass'
          FROM generate_series(1, 2)
        `, [policyId, signature]);
      }

      const candidates = await findPromotionCandidates(3);
      expect(candidates.length).toBe(3);
    });
  });

  describe('promoteToActive()', () => {
    it('should update policy status to active', async () => {
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'probation', 'requeue', '{}', 'low', 'test')
      `);

      const candidate = {
        policy_id: '00000000-0000-0000-0000-000000000001',
        signature: 'test1234567890ab',
        simulate_count: 2,
        pass_count: 2,
        fail_count: 0
      };

      const success = await promoteToActive(candidate);
      expect(success).toBe(true);

      const result = await pool.query(`
        SELECT status FROM absorption_policies WHERE policy_id = $1
      `, [candidate.policy_id]);

      expect(result.rows[0].status).toBe('active');
    });

    it('should record promotion evaluation', async () => {
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'probation', 'requeue', '{}', 'low', 'test')
      `);

      const candidate = {
        policy_id: '00000000-0000-0000-0000-000000000001',
        signature: 'test1234567890ab',
        simulate_count: 2,
        pass_count: 2,
        fail_count: 0
      };

      await promoteToActive(candidate);

      const result = await pool.query(`
        SELECT * FROM policy_evaluations
        WHERE policy_id = $1 AND mode = 'promote'
      `, [candidate.policy_id]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].decision).toBe('applied');
      expect(result.rows[0].details).toHaveProperty('promoted_at');
    });

    it('should rollback on error', async () => {
      // Non-existent policy_id should cause FK error
      const candidate = {
        policy_id: '00000000-0000-0000-0000-999999999999',
        signature: 'test1234567890ab',
        simulate_count: 2,
        pass_count: 2,
        fail_count: 0
      };

      const success = await promoteToActive(candidate);
      expect(success).toBe(false);

      // No evaluation should be recorded
      const result = await pool.query(`
        SELECT COUNT(*) as count FROM policy_evaluations WHERE mode = 'promote'
      `);
      expect(parseInt(result.rows[0].count)).toBe(0);
    });
  });

  describe('findPoliciesToDisable()', () => {
    it('should find active policy with verification failure', async () => {
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'active', 'requeue', '{}', 'low', 'test')
      `);

      await pool.query(`
        INSERT INTO policy_evaluations (policy_id, signature, mode, decision, verification_result)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'enforce', 'applied', 'fail')
      `);

      const toDisable = await findPoliciesToDisable();

      expect(toDisable.length).toBe(1);
      expect(toDisable[0].policy_id).toBe('00000000-0000-0000-0000-000000000001');
      expect(toDisable[0].status).toBe('active');
      expect(toDisable[0].fail_count).toBe(1);
    });

    it('should find probation policy with 2+ failures', async () => {
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'probation', 'requeue', '{}', 'low', 'test')
      `);

      await pool.query(`
        INSERT INTO policy_evaluations (policy_id, signature, mode, decision, verification_result)
        VALUES
          ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'simulate', 'applied', 'fail'),
          ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'simulate', 'applied', 'fail')
      `);

      const toDisable = await findPoliciesToDisable();

      expect(toDisable.length).toBe(1);
      expect(toDisable[0].status).toBe('probation');
      expect(toDisable[0].fail_count).toBe(2);
    });

    it('should find stale probation policy (>7 days)', async () => {
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by, created_at)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'probation', 'requeue', '{}', 'low', 'test', NOW() - INTERVAL '8 days')
      `);

      // No evaluations, but policy is old
      const toDisable = await findPoliciesToDisable();

      expect(toDisable.length).toBe(1);
      expect(toDisable[0].status).toBe('probation');
    });

    it('should not disable probation with 1 failure', async () => {
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'probation', 'requeue', '{}', 'low', 'test')
      `);

      await pool.query(`
        INSERT INTO policy_evaluations (policy_id, signature, mode, decision, verification_result)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'simulate', 'applied', 'fail')
      `);

      const toDisable = await findPoliciesToDisable();
      expect(toDisable.length).toBe(0);
    });
  });

  describe('disablePolicy()', () => {
    it('should update policy status to disabled', async () => {
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'active', 'requeue', '{}', 'low', 'test')
      `);

      const policy = {
        policy_id: '00000000-0000-0000-0000-000000000001',
        signature: 'test1234567890ab',
        status: 'active',
        fail_count: 1,
        consecutive_fails: 0
      };

      const success = await disablePolicy(policy);
      expect(success).toBe(true);

      const result = await pool.query(`
        SELECT status FROM absorption_policies WHERE policy_id = $1
      `, [policy.policy_id]);

      expect(result.rows[0].status).toBe('disabled');
    });

    it('should record disable evaluation', async () => {
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'active', 'requeue', '{}', 'low', 'test')
      `);

      const policy = {
        policy_id: '00000000-0000-0000-0000-000000000001',
        signature: 'test1234567890ab',
        status: 'active',
        fail_count: 1,
        consecutive_fails: 0
      };

      await disablePolicy(policy);

      const result = await pool.query(`
        SELECT * FROM policy_evaluations
        WHERE policy_id = $1 AND mode = 'disable'
      `, [policy.policy_id]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].decision).toBe('applied');
      expect(result.rows[0].details).toHaveProperty('reason');
      expect(result.rows[0].details.reason).toBe('active_verification_failed');
    });

    it('should rollback on error', async () => {
      const policy = {
        policy_id: '00000000-0000-0000-0000-999999999999',
        signature: 'test1234567890ab',
        status: 'active',
        fail_count: 1,
        consecutive_fails: 0
      };

      const success = await disablePolicy(policy);
      expect(success).toBe(false);
    });
  });

  describe('runPromotionJob() - Integration', () => {
    it('should respect daily promotion limit', async () => {
      // Create 5 qualifying policies
      for (let i = 1; i <= 5; i++) {
        const policyId = `00000000-0000-0000-0000-00000000000${i}`;
        const signature = `test${i}234567890ab`;

        await pool.query(`
          INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
          VALUES ($1, $2, 'probation', 'requeue', '{}', 'low', 'test')
        `, [policyId, signature]);

        await pool.query(`
          INSERT INTO policy_evaluations (policy_id, signature, mode, decision, verification_result)
          SELECT $1, $2, 'simulate', 'applied', 'pass'
          FROM generate_series(1, 2)
        `, [policyId, signature]);
      }

      const result = await runPromotionJob();

      expect(result.promoted).toBe(3); // Max 3 per day
      expect(result.remaining_slots).toBe(0);

      // Verify only 3 promoted
      const promoted = await pool.query(`
        SELECT COUNT(*) as count FROM absorption_policies WHERE status = 'active'
      `);
      expect(parseInt(promoted.rows[0].count)).toBe(3);
    });

    it('should promote and disable in same run', async () => {
      // Create 1 qualifying policy for promotion
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'probation', 'requeue', '{}', 'low', 'test')
      `);

      await pool.query(`
        INSERT INTO policy_evaluations (policy_id, signature, mode, decision, verification_result)
        SELECT '00000000-0000-0000-0000-000000000001'::UUID, 'test1234567890ab', 'simulate', 'applied', 'pass'
        FROM generate_series(1, 2)
      `);

      // Create 1 active policy with failure
      await pool.query(`
        INSERT INTO absorption_policies (policy_id, signature, status, policy_type, policy_json, risk_level, created_by)
        VALUES ('00000000-0000-0000-0000-000000000002'::UUID, 'test2345678901ab', 'active', 'requeue', '{}', 'low', 'test')
      `);

      await pool.query(`
        INSERT INTO policy_evaluations (policy_id, signature, mode, decision, verification_result)
        VALUES ('00000000-0000-0000-0000-000000000002'::UUID, 'test2345678901ab', 'enforce', 'applied', 'fail')
      `);

      const result = await runPromotionJob();

      expect(result.promoted).toBe(1);
      expect(result.disabled).toBe(1);

      // Verify states
      const active = await pool.query(`SELECT COUNT(*) as count FROM absorption_policies WHERE status = 'active'`);
      const disabled = await pool.query(`SELECT COUNT(*) as count FROM absorption_policies WHERE status = 'disabled'`);

      expect(parseInt(active.rows[0].count)).toBe(1);
      expect(parseInt(disabled.rows[0].count)).toBe(1);
    });
  });
});
