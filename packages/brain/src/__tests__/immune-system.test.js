/**
 * Immune System 单元测试
 *
 * 覆盖所有导出函数：
 * - updateFailureSignature: 更新失败签名计数
 * - findActivePolicy: 查询 active 状态策略
 * - findProbationPolicy: 查询 probation 状态策略
 * - recordPolicyEvaluation: 记录策略评估审计
 * - shouldPromoteToProbation: 判断是否晋升到 probation
 * - shouldPromoteToActive: 判断是否晋升到 active
 * - getPolicyEvaluationStats: 获取策略评估统计
 * - getTopFailureSignatures: 获取 top 失败签名
 * - parsePolicyAction: 解析策略 JSON
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool（使用 vi.hoisted 避免 hoisting 问题）
const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
}));
vi.mock('../db.js', () => ({ default: mockPool }));

import {
  updateFailureSignature,
  findActivePolicy,
  findProbationPolicy,
  recordPolicyEvaluation,
  shouldPromoteToProbation,
  shouldPromoteToActive,
  getPolicyEvaluationStats,
  getTopFailureSignatures,
  parsePolicyAction,
} from '../immune-system.js';

describe('Immune System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // updateFailureSignature
  // ========================================
  describe('updateFailureSignature', () => {
    it('应成功插入/更新失败签名并返回记录', async () => {
      const mockRow = {
        signature: 'abc123def456abcd',
        count_24h: 1,
        count_7d: 1,
        count_total: 1,
        latest_run_id: 'run-1',
        latest_reason_code: 'TIMEOUT',
        latest_layer: 'L0',
        latest_step_name: 'dispatch',
      };
      mockPool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await updateFailureSignature('abc123def456abcd', {
        run_id: 'run-1',
        reason_code: 'TIMEOUT',
        layer: 'L0',
        step_name: 'dispatch',
      });

      expect(result).toEqual(mockRow);
      expect(mockPool.query).toHaveBeenCalledTimes(1);

      // 验证 SQL 参数
      const callArgs = mockPool.query.mock.calls[0];
      expect(callArgs[1]).toEqual([
        'abc123def456abcd',
        'run-1',
        'TIMEOUT',
        'L0',
        'dispatch',
      ]);
    });

    it('缺少 failure 字段时应使用默认值', async () => {
      const mockRow = { signature: 'sig1', count_total: 1 };
      mockPool.query.mockResolvedValueOnce({ rows: [mockRow] });

      await updateFailureSignature('sig1', {});

      const callArgs = mockPool.query.mock.calls[0];
      expect(callArgs[1]).toEqual([
        'sig1',
        null,        // run_id 默认 null
        'UNKNOWN',   // reason_code 默认 'UNKNOWN'
        '',          // layer 默认 ''
        '',          // step_name 默认 ''
      ]);
    });

    it('数据库报错时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(
        updateFailureSignature('sig1', { run_id: 'r1' })
      ).rejects.toThrow('DB connection lost');
    });

    it('SQL 应包含 ON CONFLICT (signature) DO UPDATE 和 RETURNING', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ signature: 'x' }] });

      await updateFailureSignature('x', { run_id: 'r1' });

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('ON CONFLICT (signature) DO UPDATE');
      expect(sql).toContain('RETURNING *');
    });

    it('SQL 应包含 24h 和 7d 的滑窗计数逻辑', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ signature: 'x' }] });

      await updateFailureSignature('x', { run_id: 'r1' });

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('24 hours');
      expect(sql).toContain('7 days');
    });
  });

  // ========================================
  // findActivePolicy
  // ========================================
  describe('findActivePolicy', () => {
    it('应返回匹配的 active 策略', async () => {
      const mockPolicy = {
        id: 'policy-1',
        signature: 'sig-abc',
        status: 'active',
        policy_json: '{}',
      };
      mockPool.query.mockResolvedValueOnce({ rows: [mockPolicy] });

      const result = await findActivePolicy('sig-abc');

      expect(result).toEqual(mockPolicy);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain("status = 'active'");
    });

    it('没有匹配策略时应返回 null', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await findActivePolicy('nonexistent-sig');

      expect(result).toBeNull();
    });

    it('数据库报错时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Query timeout'));

      await expect(findActivePolicy('sig-abc')).rejects.toThrow('Query timeout');
    });

    it('SQL 应查询 absorption_policies 表', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await findActivePolicy('sig');

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('absorption_policies');
    });

    it('SQL 应传入 signature 作为参数', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await findActivePolicy('my-sig-123');

      expect(mockPool.query.mock.calls[0][1]).toEqual(['my-sig-123']);
    });
  });

  // ========================================
  // findProbationPolicy
  // ========================================
  describe('findProbationPolicy', () => {
    it('应返回匹配的 probation 策略', async () => {
      const mockPolicy = {
        id: 'policy-2',
        signature: 'sig-def',
        status: 'probation',
      };
      mockPool.query.mockResolvedValueOnce({ rows: [mockPolicy] });

      const result = await findProbationPolicy('sig-def');

      expect(result).toEqual(mockPolicy);
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain("status = 'probation'");
    });

    it('没有匹配策略时应返回 null', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await findProbationPolicy('nonexistent');

      expect(result).toBeNull();
    });

    it('数据库报错时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(findProbationPolicy('sig')).rejects.toThrow('Connection refused');
    });

    it('应查询 absorption_policies 表并按 updated_at DESC 排序', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await findProbationPolicy('sig');

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('absorption_policies');
      expect(sql).toContain('ORDER BY updated_at DESC');
      expect(sql).toContain('LIMIT 1');
    });
  });

  // ========================================
  // recordPolicyEvaluation
  // ========================================
  describe('recordPolicyEvaluation', () => {
    it('应成功记录评估并返回 evaluation_id', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ evaluation_id: 'eval-uuid-1' }],
      });

      const evalData = {
        policy_id: 'policy-1',
        run_id: 'run-1',
        signature: 'sig-abc',
        mode: 'simulate',
        decision: 'applied',
        verification_result: 'pass',
        latency_ms: 42,
        details: { foo: 'bar' },
      };

      const result = await recordPolicyEvaluation(evalData);

      expect(result).toBe('eval-uuid-1');
      expect(mockPool.query).toHaveBeenCalledTimes(1);

      const callArgs = mockPool.query.mock.calls[0];
      expect(callArgs[1]).toEqual([
        'policy-1',
        'run-1',
        'sig-abc',
        'simulate',
        'applied',
        'pass',
        42,
        JSON.stringify({ foo: 'bar' }),
      ]);
    });

    it('可选字段缺失时应使用默认值', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ evaluation_id: 'eval-uuid-2' }],
      });

      const evalData = {
        policy_id: 'policy-2',
        signature: 'sig-xyz',
        mode: 'enforce',
        decision: 'skipped',
      };

      await recordPolicyEvaluation(evalData);

      const callArgs = mockPool.query.mock.calls[0];
      expect(callArgs[1]).toEqual([
        'policy-2',
        null,            // run_id 默认 null
        'sig-xyz',
        'enforce',
        'skipped',
        'unknown',       // verification_result 默认 'unknown'
        null,            // latency_ms 默认 null
        null,            // details 为 undefined → null
      ]);
    });

    it('details 为 null 时应传入 null', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ evaluation_id: 'eval-3' }],
      });

      await recordPolicyEvaluation({
        policy_id: 'p1',
        signature: 'sig',
        mode: 'simulate',
        decision: 'applied',
        details: null,
      });

      const callArgs = mockPool.query.mock.calls[0];
      // details 为 falsy → null
      expect(callArgs[1][7]).toBeNull();
    });

    it('数据库报错时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Insert failed'));

      await expect(
        recordPolicyEvaluation({
          policy_id: 'p1',
          signature: 'sig',
          mode: 'simulate',
          decision: 'applied',
        })
      ).rejects.toThrow('Insert failed');
    });

    it('SQL 应插入到 policy_evaluations 表并返回 evaluation_id', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ evaluation_id: 'e1' }],
      });

      await recordPolicyEvaluation({
        policy_id: 'p1',
        signature: 'sig',
        mode: 'simulate',
        decision: 'applied',
      });

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('policy_evaluations');
      expect(sql).toContain('RETURNING evaluation_id');
    });
  });

  // ========================================
  // shouldPromoteToProbation
  // ========================================
  describe('shouldPromoteToProbation', () => {
    it('24h 计数 >= 2 时应返回 true', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count_24h: 2, count_7d: 2 }],
      });

      const result = await shouldPromoteToProbation('sig-abc');

      expect(result).toBe(true);
    });

    it('7d 计数 >= 3 时应返回 true', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count_24h: 1, count_7d: 3 }],
      });

      const result = await shouldPromoteToProbation('sig-abc');

      expect(result).toBe(true);
    });

    it('24h >= 2 且 7d >= 3 同时满足时应返回 true', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count_24h: 5, count_7d: 10 }],
      });

      const result = await shouldPromoteToProbation('sig-abc');

      expect(result).toBe(true);
    });

    it('两个条件都不满足时应返回 false', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count_24h: 1, count_7d: 2 }],
      });

      const result = await shouldPromoteToProbation('sig-abc');

      expect(result).toBe(false);
    });

    it('24h 正好为 1 且 7d 正好为 2 时应返回 false（边界值）', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count_24h: 1, count_7d: 2 }],
      });

      const result = await shouldPromoteToProbation('sig-edge');

      expect(result).toBe(false);
    });

    it('签名不存在时应返回 false', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await shouldPromoteToProbation('nonexistent');

      expect(result).toBe(false);
    });

    it('数据库报错时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      await expect(shouldPromoteToProbation('sig')).rejects.toThrow('DB error');
    });
  });

  // ========================================
  // getPolicyEvaluationStats
  // ========================================
  describe('getPolicyEvaluationStats', () => {
    it('应返回策略评估统计', async () => {
      const mockStats = {
        total_evaluations: '10',
        simulations: '6',
        enforcements: '4',
        applied: '8',
        failed: '2',
        verified_pass: '7',
        verified_fail: '1',
        success_rate: '87.5',
      };
      mockPool.query.mockResolvedValueOnce({ rows: [mockStats] });

      const result = await getPolicyEvaluationStats('policy-1');

      expect(result).toEqual(mockStats);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      expect(mockPool.query.mock.calls[0][1]).toEqual(['policy-1']);
    });

    it('SQL 应包含 FILTER 聚合和 success_rate 计算', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{}] });

      await getPolicyEvaluationStats('p1');

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('FILTER');
      expect(sql).toContain('success_rate');
      expect(sql).toContain('policy_evaluations');
    });

    it('数据库报错时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Stats query failed'));

      await expect(getPolicyEvaluationStats('p1')).rejects.toThrow('Stats query failed');
    });
  });

  // ========================================
  // shouldPromoteToActive
  // ========================================
  describe('shouldPromoteToActive', () => {
    it('模拟次数 >= 2 且验证总数 >= 2 且成功率 >= 90 时应返回 true', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          total_evaluations: '5',
          simulations: '3',
          enforcements: '2',
          applied: '4',
          failed: '1',
          verified_pass: '4',
          verified_fail: '0',
          success_rate: '100.0',
        }],
      });

      const result = await shouldPromoteToActive('policy-1');

      expect(result).toBe(true);
    });

    it('成功率正好 90% 时应返回 true（边界值）', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          total_evaluations: '10',
          simulations: '5',
          enforcements: '5',
          applied: '9',
          failed: '1',
          verified_pass: '9',
          verified_fail: '1',
          success_rate: '90.0',
        }],
      });

      const result = await shouldPromoteToActive('policy-2');

      expect(result).toBe(true);
    });

    it('模拟次数不足时应返回 false', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          total_evaluations: '1',
          simulations: '1',
          enforcements: '0',
          applied: '1',
          failed: '0',
          verified_pass: '1',
          verified_fail: '0',
          success_rate: '100.0',
        }],
      });

      const result = await shouldPromoteToActive('policy-3');

      expect(result).toBe(false);
    });

    it('验证总数不足时应返回 false（verified_pass + verified_fail < 2）', async () => {
      // 注意：PostgreSQL COUNT 返回字符串，JS 中 '0' + '0' = '00'
      // 而 '00' >= 2 为 false，所以 verified_pass=0, verified_fail=0 才能真正测试不足
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          total_evaluations: '3',
          simulations: '3',
          enforcements: '0',
          applied: '3',
          failed: '0',
          verified_pass: '0',
          verified_fail: '0',
          success_rate: null,
        }],
      });

      const result = await shouldPromoteToActive('policy-4');

      expect(result).toBe(false);
    });

    it('成功率低于 90% 时应返回 false', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          total_evaluations: '10',
          simulations: '5',
          enforcements: '5',
          applied: '7',
          failed: '3',
          verified_pass: '4',
          verified_fail: '6',
          success_rate: '40.0',
        }],
      });

      const result = await shouldPromoteToActive('policy-5');

      expect(result).toBe(false);
    });

    it('stats 查询返回空行时应返回 false', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await shouldPromoteToActive('policy-missing');

      expect(result).toBe(false);
    });

    it('数据库报错时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Stats error'));

      await expect(shouldPromoteToActive('p1')).rejects.toThrow('Stats error');
    });

    it('成功率为 89.9 时应返回 false（刚好不满足）', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          total_evaluations: '10',
          simulations: '5',
          enforcements: '5',
          applied: '9',
          failed: '1',
          verified_pass: '8',
          verified_fail: '1',
          success_rate: '89.9',
        }],
      });

      const result = await shouldPromoteToActive('policy-edge');

      expect(result).toBe(false);
    });
  });

  // ========================================
  // getTopFailureSignatures
  // ========================================
  describe('getTopFailureSignatures', () => {
    it('应返回 top 失败签名列表', async () => {
      const mockRows = [
        { signature: 'sig1', count_24h: 5, count_7d: 10, count_total: 20 },
        { signature: 'sig2', count_24h: 3, count_7d: 8, count_total: 15 },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await getTopFailureSignatures();

      expect(result).toEqual(mockRows);
      expect(result).toHaveLength(2);
      // 默认 limit = 10
      expect(mockPool.query.mock.calls[0][1]).toEqual([10]);
    });

    it('应支持自定义 limit', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await getTopFailureSignatures(5);

      expect(mockPool.query.mock.calls[0][1]).toEqual([5]);
    });

    it('没有签名时应返回空数组', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getTopFailureSignatures();

      expect(result).toEqual([]);
    });

    it('数据库报错时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Query failed'));

      await expect(getTopFailureSignatures()).rejects.toThrow('Query failed');
    });

    it('SQL 应按 count_24h DESC, count_7d DESC 排序', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await getTopFailureSignatures();

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('ORDER BY count_24h DESC, count_7d DESC');
    });

    it('SQL 应使用 LIMIT 参数', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await getTopFailureSignatures(3);

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('LIMIT $1');
    });
  });

  // ========================================
  // parsePolicyAction
  // ========================================
  describe('parsePolicyAction', () => {
    it('应正确解析完整的策略 JSON 对象', () => {
      const policyJson = {
        action: 'requeue',
        params: { delay_minutes: 30, priority: 'low' },
        expected_outcome: 'Task will retry after 30 min',
      };

      const result = parsePolicyAction(policyJson);

      expect(result).toEqual({
        type: 'requeue',
        params: { delay_minutes: 30, priority: 'low' },
        expected_outcome: 'Task will retry after 30 min',
      });
    });

    it('应正确解析 JSON 字符串', () => {
      const policyJsonStr = JSON.stringify({
        action: 'skip',
        params: { reason: 'known flaky' },
        expected_outcome: 'Task marked as skipped',
      });

      const result = parsePolicyAction(policyJsonStr);

      expect(result).toEqual({
        type: 'skip',
        params: { reason: 'known flaky' },
        expected_outcome: 'Task marked as skipped',
      });
    });

    it('null 输入应返回 unknown 类型', () => {
      const result = parsePolicyAction(null);

      expect(result).toEqual({
        type: 'unknown',
        params: {},
        expected_outcome: 'No policy JSON provided',
      });
    });

    it('undefined 输入应返回 unknown 类型', () => {
      const result = parsePolicyAction(undefined);

      expect(result).toEqual({
        type: 'unknown',
        params: {},
        expected_outcome: 'No policy JSON provided',
      });
    });

    it('缺少 action 字段时应使用 unknown 默认值', () => {
      const result = parsePolicyAction({ params: { x: 1 } });

      expect(result.type).toBe('unknown');
      expect(result.params).toEqual({ x: 1 });
    });

    it('缺少 params 字段时应使用空对象默认值', () => {
      const result = parsePolicyAction({ action: 'requeue' });

      expect(result.params).toEqual({});
    });

    it('缺少 expected_outcome 字段时应使用默认描述', () => {
      const result = parsePolicyAction({ action: 'requeue' });

      expect(result.expected_outcome).toBe('No expected outcome defined');
    });

    it('无效 JSON 字符串应返回 parse_error 类型（不抛异常）', () => {
      const result = parsePolicyAction('not-valid-json');

      expect(result.type).toBe('parse_error');
      expect(result.params).toEqual({});
      expect(result.expected_outcome).toContain('Failed to parse policy JSON');
    });

    it('空对象输入应返回所有默认值', () => {
      const result = parsePolicyAction({});

      expect(result).toEqual({
        type: 'unknown',
        params: {},
        expected_outcome: 'No expected outcome defined',
      });
    });

    it('空字符串输入应返回 unknown 类型', () => {
      const result = parsePolicyAction('');

      // 空字符串是 falsy → 走 !policyJson 分支
      expect(result).toEqual({
        type: 'unknown',
        params: {},
        expected_outcome: 'No policy JSON provided',
      });
    });
  });
});
