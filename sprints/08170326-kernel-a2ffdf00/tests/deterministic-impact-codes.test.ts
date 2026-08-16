/**
 * 冻结合同测试 — DETERMINISTIC_IMPACT_ERROR_CODES 集合（确定性出口的路由使能）
 *
 * PRD 修法 B：DETERMINISTIC_IMPACT_ERROR_CODES 从 loop.js 局部常量升为 constants.js 导出，
 * 并补齐 radius 确定性 reason_code + fail-closed 兜底码；loop.js 据此把 retryable:false 的
 * impact 结论归 failure_class=impact_contract_invalid，走确定性出口而非 infrastructure_blocked 退避。
 *
 * 语义锚点（Invariant [同语义同策略]）：判变端（diff-gate 分类）与消费端（loop 路由）
 * 必须共用同一确定性码集合，禁止跨脚本分叉出假绿面。
 */
import { describe, it, expect } from 'vitest';
import { DETERMINISTIC_IMPACT_ERROR_CODES } from '../../../packages/brain/src/orchestrator/constants.js';

const DETERMINISTIC_REASONS = [
  'impact_anchor_missing',
  'capability_assertion_coverage_missing',
  'capability_not_in_active_projection',
  'unsafe_assertion_ref',
  'assertion_identity_ambiguous',
  'mapper_contract_invalid',
];

describe('DETERMINISTIC_IMPACT_ERROR_CODES', () => {
  it('由 constants.js 导出且为 Set', () => {
    expect(DETERMINISTIC_IMPACT_ERROR_CODES).toBeInstanceOf(Set);
  });

  it.each(DETERMINISTIC_REASONS)('包含确定性 reason %s', (reason) => {
    expect(DETERMINISTIC_IMPACT_ERROR_CODES.has(reason)).toBe(true);
  });

  it('不包含真新鲜度可重试码（回归保护：mapper_stale 语义仍可重试）', () => {
    for (const retryable of ['fact_snapshot_stale', 'projection_revision_missing', 'mapper_stale']) {
      expect(DETERMINISTIC_IMPACT_ERROR_CODES.has(retryable)).toBe(false);
    }
  });
});
