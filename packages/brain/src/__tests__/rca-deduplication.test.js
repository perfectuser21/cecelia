/**
 * RCA Deduplication 单元测试
 *
 * 测试 rca-deduplication.js 的所有导出函数：
 * - generateErrorSignature: 错误签名生成
 * - shouldAnalyzeFailure: 判断是否需要 RCA 分析（24h 去重）
 * - cacheRcaResult: 缓存 RCA 分析结果
 * - getRcaCacheStats: 获取缓存统计
 * - cleanOldCache: 清理过期缓存
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const mockPool = {
  query: vi.fn(),
};

vi.mock('../db.js', () => ({ default: mockPool }));

const {
  generateErrorSignature,
  shouldAnalyzeFailure,
  cacheRcaResult,
  getRcaCacheStats,
  cleanOldCache,
} = await import('../rca-deduplication.js');

// 辅助函数：计算预期签名（与源代码逻辑一致）
function expectedSignature(reasonCode, layer, stepName) {
  const parts = [reasonCode || 'UNKNOWN', layer || '', stepName || ''].filter(Boolean);
  const sig = parts.join(':');
  return crypto.createHash('sha256').update(sig).digest('hex').substring(0, 16);
}

describe('rca-deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // generateErrorSignature 测试
  // ============================================
  describe('generateErrorSignature', () => {
    it('应正确生成包含所有字段的错误签名', () => {
      const failure = {
        reason_code: 'TIMEOUT',
        layer: 'L2_executor',
        step_name: 'dispatch',
      };
      const sig = generateErrorSignature(failure);

      // 签名应为 16 字符的十六进制字符串
      expect(sig).toHaveLength(16);
      expect(sig).toMatch(/^[0-9a-f]{16}$/);

      // 应与手动计算一致
      const expected = expectedSignature('TIMEOUT', 'L2_executor', 'dispatch');
      expect(sig).toBe(expected);
    });

    it('应在 reason_code 缺失时使用 UNKNOWN', () => {
      const failure = { layer: 'L1_thalamus', step_name: 'route' };
      const sig = generateErrorSignature(failure);

      const expected = expectedSignature('UNKNOWN', 'L1_thalamus', 'route');
      expect(sig).toBe(expected);
    });

    it('应在 reason_code 为空字符串时使用 UNKNOWN', () => {
      const failure = { reason_code: '', layer: 'L0', step_name: 'check' };
      const sig = generateErrorSignature(failure);

      // reason_code='' → '' || 'UNKNOWN' = 'UNKNOWN'
      const expected = expectedSignature('UNKNOWN', 'L0', 'check');
      expect(sig).toBe(expected);
    });

    it('应在只有 reason_code 时生成有效签名', () => {
      const failure = { reason_code: 'OOM' };
      const sig = generateErrorSignature(failure);

      const expected = expectedSignature('OOM', '', '');
      expect(sig).toBe(expected);
      expect(sig).toHaveLength(16);
    });

    it('应在所有字段缺失时使用 UNKNOWN', () => {
      const failure = {};
      const sig = generateErrorSignature(failure);

      const expected = expectedSignature('UNKNOWN', '', '');
      expect(sig).toBe(expected);
    });

    it('相同输入应生成相同签名（确定性）', () => {
      const failure = { reason_code: 'ERR_A', layer: 'L2', step_name: 'analyze' };
      const sig1 = generateErrorSignature(failure);
      const sig2 = generateErrorSignature(failure);
      expect(sig1).toBe(sig2);
    });

    it('不同输入应生成不同签名', () => {
      const f1 = { reason_code: 'TIMEOUT', layer: 'L2', step_name: 'dispatch' };
      const f2 = { reason_code: 'OOM', layer: 'L2', step_name: 'dispatch' };
      expect(generateErrorSignature(f1)).not.toBe(generateErrorSignature(f2));
    });
  });

  // ============================================
  // shouldAnalyzeFailure 测试
  // ============================================
  describe('shouldAnalyzeFailure', () => {
    it('无缓存命中时应返回 should_analyze=true', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const failure = { reason_code: 'TIMEOUT', layer: 'L2', step_name: 'run' };
      const result = await shouldAnalyzeFailure(failure);

      expect(result.should_analyze).toBe(true);
      expect(result.signature).toBe(expectedSignature('TIMEOUT', 'L2', 'run'));
      expect(result.cached_result).toBeUndefined();
    });

    it('24h 内有缓存时应返回 should_analyze=false 并附带 cached_result', async () => {
      const cachedRow = {
        root_cause: '内存泄漏导致 OOM',
        proposed_fix: '增加内存限制',
        action_plan: '1. 增加到 4GB 2. 添加监控',
        confidence: 0.85,
        evidence: 'dmesg 日志显示 OOM killer',
        ts_analyzed: new Date('2026-03-06T10:00:00Z'),
        hours_ago: '2.5',
      };
      mockPool.query.mockResolvedValueOnce({ rows: [cachedRow] });

      const failure = { reason_code: 'OOM', layer: 'L2', step_name: 'execute' };
      const result = await shouldAnalyzeFailure(failure);

      expect(result.should_analyze).toBe(false);
      expect(result.signature).toBe(expectedSignature('OOM', 'L2', 'execute'));
      expect(result.cached_result).toEqual({
        root_cause: '内存泄漏导致 OOM',
        proposed_fix: '增加内存限制',
        action_plan: '1. 增加到 4GB 2. 添加监控',
        confidence: 0.85,
        evidence: 'dmesg 日志显示 OOM killer',
        ts_analyzed: cachedRow.ts_analyzed,
      });
    });

    it('应向数据库传递正确的签名参数', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const failure = { reason_code: 'CI_FAIL', layer: 'L1', step_name: 'triage' };
      await shouldAnalyzeFailure(failure);

      const expectedSig = expectedSignature('CI_FAIL', 'L1', 'triage');
      expect(mockPool.query).toHaveBeenCalledOnce();
      expect(mockPool.query.mock.calls[0][1]).toEqual([expectedSig]);
    });

    it('hours_ago 为 null 时应默认为 0', async () => {
      const cachedRow = {
        root_cause: '测试',
        proposed_fix: '修复',
        action_plan: '',
        confidence: 0.5,
        evidence: '',
        ts_analyzed: new Date(),
        hours_ago: null,
      };
      mockPool.query.mockResolvedValueOnce({ rows: [cachedRow] });

      const failure = { reason_code: 'ERR', layer: 'L0', step_name: 'check' };
      const result = await shouldAnalyzeFailure(failure);

      // 不应抛出异常，hours_ago 为 null 时 parseFloat 返回 NaN，|| 0 保护
      expect(result.should_analyze).toBe(false);
    });

    it('数据库查询抛出异常时应向上传播', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('连接被拒绝'));

      const failure = { reason_code: 'ERR', layer: 'L0', step_name: 'x' };
      await expect(shouldAnalyzeFailure(failure)).rejects.toThrow('连接被拒绝');
    });
  });

  // ============================================
  // cacheRcaResult 测试
  // ============================================
  describe('cacheRcaResult', () => {
    it('应使用正确参数插入缓存', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const failure = { reason_code: 'TIMEOUT', layer: 'L2', step_name: 'dispatch' };
      const rcaResult = {
        root_cause: '网络超时',
        proposed_fix: '增加超时时间',
        action_plan: '修改配置',
        confidence: 0.9,
        evidence: '日志分析',
      };

      await cacheRcaResult(failure, rcaResult);

      expect(mockPool.query).toHaveBeenCalledOnce();
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO rca_cache');
      expect(sql).toContain('ON CONFLICT (signature)');

      const expectedSig = expectedSignature('TIMEOUT', 'L2', 'dispatch');
      expect(params[0]).toBe(expectedSig);           // signature
      expect(params[1]).toBe('TIMEOUT');              // reason_code
      expect(params[2]).toBe('L2');                   // layer
      expect(params[3]).toBe('dispatch');             // step_name
      expect(params[4]).toBe('网络超时');             // root_cause
      expect(params[5]).toBe('增加超时时间');         // proposed_fix
      expect(params[6]).toBe('修改配置');             // action_plan
      expect(params[7]).toBe(0.9);                    // confidence
      expect(params[8]).toBe('日志分析');             // evidence
    });

    it('应对缺失的 rcaResult 字段使用默认值', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const failure = { reason_code: 'ERR' };
      const rcaResult = {};

      await cacheRcaResult(failure, rcaResult);

      const [, params] = mockPool.query.mock.calls[0];
      expect(params[1]).toBe('ERR');      // reason_code
      expect(params[2]).toBe('');          // layer 默认空
      expect(params[3]).toBe('');          // step_name 默认空
      expect(params[4]).toBe('');          // root_cause 默认空
      expect(params[5]).toBe('');          // proposed_fix 默认空
      expect(params[6]).toBe('');          // action_plan 默认空
      expect(params[7]).toBe(0);           // confidence 默认 0
      expect(params[8]).toBe('');          // evidence 默认空
    });

    it('应对缺失的 failure 字段使用 UNKNOWN', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const failure = {};
      const rcaResult = { root_cause: '未知错误', confidence: 0.3 };

      await cacheRcaResult(failure, rcaResult);

      const [, params] = mockPool.query.mock.calls[0];
      expect(params[1]).toBe('UNKNOWN');  // reason_code 默认 UNKNOWN
    });

    it('数据库写入失败时应向上传播异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('磁盘空间不足'));

      const failure = { reason_code: 'ERR' };
      const rcaResult = { root_cause: '测试' };

      await expect(cacheRcaResult(failure, rcaResult)).rejects.toThrow('磁盘空间不足');
    });
  });

  // ============================================
  // getRcaCacheStats 测试
  // ============================================
  describe('getRcaCacheStats', () => {
    it('应返回数据库统计数据', async () => {
      const statsRow = {
        total_cached: '15',
        cached_last_24h: '3',
        unique_signatures: '10',
        avg_confidence: '0.78',
      };
      mockPool.query.mockResolvedValueOnce({ rows: [statsRow] });

      const result = await getRcaCacheStats();

      expect(result).toEqual(statsRow);
      expect(mockPool.query).toHaveBeenCalledOnce();
      expect(mockPool.query.mock.calls[0][0]).toContain('rca_cache');
    });

    it('缓存为空时应返回零值统计', async () => {
      const emptyStats = {
        total_cached: '0',
        cached_last_24h: '0',
        unique_signatures: '0',
        avg_confidence: null,
      };
      mockPool.query.mockResolvedValueOnce({ rows: [emptyStats] });

      const result = await getRcaCacheStats();

      expect(result.total_cached).toBe('0');
      expect(result.avg_confidence).toBeNull();
    });

    it('数据库查询失败时应向上传播异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('查询超时'));

      await expect(getRcaCacheStats()).rejects.toThrow('查询超时');
    });
  });

  // ============================================
  // cleanOldCache 测试
  // ============================================
  describe('cleanOldCache', () => {
    it('应删除超过 7 天的缓存条目并返回删除数量', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { signature: 'abc123' },
          { signature: 'def456' },
          { signature: 'ghi789' },
        ],
      });

      const count = await cleanOldCache();

      expect(count).toBe(3);
      expect(mockPool.query).toHaveBeenCalledOnce();
      expect(mockPool.query.mock.calls[0][0]).toContain('DELETE FROM rca_cache');
      expect(mockPool.query.mock.calls[0][0]).toContain('7 days');
    });

    it('无过期条目时应返回 0', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const count = await cleanOldCache();

      expect(count).toBe(0);
    });

    it('数据库操作失败时应向上传播异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('权限不足'));

      await expect(cleanOldCache()).rejects.toThrow('权限不足');
    });
  });
});
