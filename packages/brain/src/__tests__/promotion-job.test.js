/**
 * Tests for promotion-job.js (P1) — DB-mocked version
 *
 * Coverage:
 * - countPromotionsToday()
 * - findPromotionCandidates()
 * - promoteToActive()
 * - findPoliciesToDisable()
 * - disablePolicy()
 * - runPromotionJob() integration
 *
 * 所有数据库操作使用 vitest mock，无需真实 PostgreSQL 连接。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock db.js — 提供 pool.query 和 pool.connect
const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
};

const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn().mockResolvedValue(mockClient),
};

vi.mock('../db.js', () => ({
  default: mockPool,
}));

// 导入被测模块（必须在 vi.mock 之后）
const {
  runPromotionJob,
  countPromotionsToday,
  findPromotionCandidates,
  promoteToActive,
  findPoliciesToDisable,
  disablePolicy,
} = await import('../promotion-job.js');

describe('Promotion Job (P1) — mocked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [] });
    mockPool.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(mockClient);
  });

  // ============================================================
  // countPromotionsToday
  // ============================================================
  describe('countPromotionsToday()', () => {
    it('should return 0 when no promotions', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      const count = await countPromotionsToday();
      expect(count).toBe(0);
    });

    it('should return correct count from DB', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '5' }] });
      const count = await countPromotionsToday();
      expect(count).toBe(5);
    });

    it('should query only promote mode evaluations in last 24h', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });
      await countPromotionsToday();

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain("mode = 'promote'");
      expect(sql).toContain("decision = 'applied'");
      expect(sql).toContain('24 hours');
    });
  });

  // ============================================================
  // findPromotionCandidates
  // ============================================================
  describe('findPromotionCandidates()', () => {
    it('should return candidates from DB query', async () => {
      const candidate = {
        policy_id: '00000000-0000-0000-0000-000000000001',
        signature: 'test1234567890ab',
        risk_level: 'low',
        simulate_count: 3,
        pass_count: 3,
        fail_count: 0,
      };
      mockPool.query.mockResolvedValueOnce({ rows: [candidate] });

      const candidates = await findPromotionCandidates(10);
      expect(candidates.length).toBe(1);
      expect(candidates[0].policy_id).toBe('00000000-0000-0000-0000-000000000001');
      expect(candidates[0].simulate_count).toBe(3);
    });

    it('should pass limit to SQL', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await findPromotionCandidates(5);

      const params = mockPool.query.mock.calls[0][1];
      expect(params).toEqual([5]);
    });

    it('should query for probation + low risk + pass rate >= 90%', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await findPromotionCandidates(10);

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain("status = 'probation'");
      expect(sql).toContain("risk_level = 'low'");
      expect(sql).toContain('simulate_count >= 2');
      expect(sql).toContain('0.9');
    });
  });

  // ============================================================
  // promoteToActive
  // ============================================================
  describe('promoteToActive()', () => {
    it('should update policy status to active via transaction', async () => {
      const candidate = {
        policy_id: '00000000-0000-0000-0000-000000000001',
        signature: 'test1234567890ab',
        simulate_count: 2,
        pass_count: 2,
        fail_count: 0,
      };

      const success = await promoteToActive(candidate);
      expect(success).toBe(true);

      // 验证事务流程：BEGIN → UPDATE → INSERT → COMMIT
      const calls = mockClient.query.mock.calls.map(c => c[0]);
      expect(calls[0]).toBe('BEGIN');
      expect(calls[1]).toContain("status = 'active'");
      expect(calls[2]).toContain("INSERT INTO policy_evaluations");
      expect(calls[3]).toBe('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should record promotion evaluation with details', async () => {
      const candidate = {
        policy_id: '00000000-0000-0000-0000-000000000001',
        signature: 'test1234567890ab',
        simulate_count: 2,
        pass_count: 2,
        fail_count: 0,
      };

      await promoteToActive(candidate);

      // 检查 INSERT INTO policy_evaluations 的参数
      const insertCall = mockClient.query.mock.calls.find(c =>
        c[0].includes('INSERT INTO policy_evaluations')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1][0]).toBe(candidate.policy_id);
      expect(insertCall[1][1]).toBe(candidate.signature);
      const details = JSON.parse(insertCall[1][2]);
      expect(details).toHaveProperty('promoted_at');
      expect(details.simulate_count).toBe(2);
    });

    it('should rollback on error', async () => {
      mockClient.query.mockImplementation((sql) => {
        if (sql === 'BEGIN') return Promise.resolve({ rows: [] });
        if (sql.includes('UPDATE')) return Promise.reject(new Error('FK violation'));
        if (sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      });

      const candidate = {
        policy_id: '00000000-0000-0000-0000-999999999999',
        signature: 'test1234567890ab',
        simulate_count: 2,
        pass_count: 2,
        fail_count: 0,
      };

      const success = await promoteToActive(candidate);
      expect(success).toBe(false);

      const calls = mockClient.query.mock.calls.map(c => c[0]);
      expect(calls).toContain('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  // ============================================================
  // findPoliciesToDisable
  // ============================================================
  describe('findPoliciesToDisable()', () => {
    it('should return policies from DB query', async () => {
      const policy = {
        policy_id: '00000000-0000-0000-0000-000000000001',
        status: 'active',
        signature: 'test1234567890ab',
        fail_count: 1,
        consecutive_fails: 0,
      };
      mockPool.query.mockResolvedValueOnce({ rows: [policy] });

      const toDisable = await findPoliciesToDisable();
      expect(toDisable.length).toBe(1);
      expect(toDisable[0].policy_id).toBe('00000000-0000-0000-0000-000000000001');
      expect(toDisable[0].status).toBe('active');
    });

    it('should query for active failures and probation failures and stale', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await findPoliciesToDisable();

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain("status = 'active'");
      expect(sql).toContain("status = 'probation'");
      expect(sql).toContain('stale_probation');
    });
  });

  // ============================================================
  // disablePolicy
  // ============================================================
  describe('disablePolicy()', () => {
    it('should update policy status to disabled via transaction', async () => {
      const policy = {
        policy_id: '00000000-0000-0000-0000-000000000001',
        signature: 'test1234567890ab',
        status: 'active',
        fail_count: 1,
        consecutive_fails: 0,
      };

      const success = await disablePolicy(policy);
      expect(success).toBe(true);

      const calls = mockClient.query.mock.calls.map(c => c[0]);
      expect(calls[0]).toBe('BEGIN');
      expect(calls[1]).toContain("status = 'disabled'");
      expect(calls[2]).toContain("INSERT INTO policy_evaluations");
      expect(calls[3]).toBe('COMMIT');
    });

    it('should record disable evaluation with correct reason', async () => {
      const policy = {
        policy_id: '00000000-0000-0000-0000-000000000001',
        signature: 'test1234567890ab',
        status: 'active',
        fail_count: 1,
        consecutive_fails: 0,
      };

      await disablePolicy(policy);

      const insertCall = mockClient.query.mock.calls.find(c =>
        c[0].includes('INSERT INTO policy_evaluations')
      );
      expect(insertCall).toBeDefined();
      const details = JSON.parse(insertCall[1][2]);
      expect(details).toHaveProperty('reason');
      expect(details.reason).toBe('active_verification_failed');
    });

    it('should rollback on error', async () => {
      mockClient.query.mockImplementation((sql) => {
        if (sql === 'BEGIN') return Promise.resolve({ rows: [] });
        if (sql.includes('UPDATE')) return Promise.reject(new Error('FK violation'));
        if (sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      });

      const policy = {
        policy_id: '00000000-0000-0000-0000-999999999999',
        signature: 'test1234567890ab',
        status: 'active',
        fail_count: 1,
        consecutive_fails: 0,
      };

      const success = await disablePolicy(policy);
      expect(success).toBe(false);
    });
  });

  // ============================================================
  // runPromotionJob — Integration
  // ============================================================
  describe('runPromotionJob() - Integration', () => {
    it('should respect daily promotion limit (0 remaining → no promotion)', async () => {
      // countPromotionsToday returns 3 (= MAX_PROMOTIONS_PER_DAY)
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '3' }] })   // countPromotionsToday
        // findPoliciesToDisable
        .mockResolvedValueOnce({ rows: [] });

      const result = await runPromotionJob();
      expect(result.promoted).toBe(0);
      expect(result.remaining_slots).toBe(0);
    });

    it('should promote candidates when slots available', async () => {
      const candidate = {
        policy_id: '00000000-0000-0000-0000-000000000001',
        signature: 'test1234567890ab',
        simulate_count: 2,
        pass_count: 2,
        fail_count: 0,
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })    // countPromotionsToday
        .mockResolvedValueOnce({ rows: [candidate] })           // findPromotionCandidates
        .mockResolvedValueOnce({ rows: [] });                   // findPoliciesToDisable

      const result = await runPromotionJob();
      expect(result.promoted).toBe(1);
      expect(result.remaining_slots).toBe(2);  // 3 - 0 - 1 = 2
    });

    it('should promote and disable in same run', async () => {
      const candidate = {
        policy_id: '00000000-0000-0000-0000-000000000001',
        signature: 'test1234567890ab',
        simulate_count: 2,
        pass_count: 2,
        fail_count: 0,
      };
      const toDisable = {
        policy_id: '00000000-0000-0000-0000-000000000002',
        status: 'active',
        signature: 'test2345678901ab',
        fail_count: 1,
        consecutive_fails: 0,
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })    // countPromotionsToday
        .mockResolvedValueOnce({ rows: [candidate] })           // findPromotionCandidates
        .mockResolvedValueOnce({ rows: [toDisable] });          // findPoliciesToDisable

      const result = await runPromotionJob();
      expect(result.promoted).toBe(1);
      expect(result.disabled).toBe(1);
    });
  });
});
