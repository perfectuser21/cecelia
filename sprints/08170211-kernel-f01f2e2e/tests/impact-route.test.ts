/**
 * 合同冻结测试 — 确定性 impact 结论的 loop/derive 路由（PRD r8 · 验收点 3）
 *
 * 被改的边：
 *   1) loop.js DETERMINISTIC_IMPACT_ERROR_CODES 需补齐确定性 reason（failure_class=impact_contract_invalid，
 *      retryable:false 不再走 infrastructure_blocked 退避重试）。→ 导出该 Set，断言成员。
 *   2) derive.js 新增纯函数 routeDeterministicImpact，按 reason 路由 generator-fix / human_review。
 *
 * 现状（RED 依据）：DETERMINISTIC_IMPACT_ERROR_CODES 未含这些 reason（import 得到的成员集合缺失）；
 *   routeDeterministicImpact 尚不存在（import 得到 undefined）。
 */
import { describe, it, expect } from 'vitest';
import { DETERMINISTIC_IMPACT_ERROR_CODES } from '../../../packages/brain/src/orchestrator/loop.js';
import { routeDeterministicImpact } from '../../../packages/brain/src/orchestrator/derive.js';

const DETERMINISTIC_REASONS = [
  'impact_anchor_missing',
  'capability_assertion_coverage_missing',
  'capability_not_in_active_projection',
  'unsafe_assertion_ref',
  'assertion_identity_ambiguous',
];

describe('loop.js DETERMINISTIC_IMPACT_ERROR_CODES 补集', () => {
  it('确定性 reason 全部纳入（retryable:false → impact_contract_invalid，不退避重试）', () => {
    expect(DETERMINISTIC_IMPACT_ERROR_CODES).toBeInstanceOf(Set);
    for (const reason of DETERMINISTIC_REASONS) {
      expect(DETERMINISTIC_IMPACT_ERROR_CODES.has(reason)).toBe(true);
    }
  });
});

describe('derive.routeDeterministicImpact 按 reason 路由', () => {
  it('impact_anchor_missing 首次 → spawn:generator-fix，detail 携带 unclaimed_files', () => {
    const route = routeDeterministicImpact({
      reason: 'impact_anchor_missing',
      unclaimedFiles: ['DoD.md'],
      generatorFixAttempts: 0,
    });
    expect(route.action).toBe('spawn:generator-fix');
    expect(route.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('impact_anchor_missing 已重试一次仍失败 → wait:human_review，不再退避重试', () => {
    const route = routeDeterministicImpact({
      reason: 'impact_anchor_missing',
      unclaimedFiles: ['DoD.md'],
      generatorFixAttempts: 1,
    });
    expect(route.action).toBe('wait:human_review');
  });

  it('capability_assertion_coverage_missing → 直接 wait:human_review', () => {
    const route = routeDeterministicImpact({
      reason: 'capability_assertion_coverage_missing',
      capabilityIds: ['G1'],
      generatorFixAttempts: 0,
    });
    expect(route.action).toBe('wait:human_review');
  });

  it('其余确定性 reason（unsafe_assertion_ref 等）→ wait:human_review（保守，不退避）', () => {
    for (const reason of ['capability_not_in_active_projection', 'unsafe_assertion_ref', 'assertion_identity_ambiguous']) {
      const route = routeDeterministicImpact({ reason, generatorFixAttempts: 0 });
      expect(route.action).toBe('wait:human_review');
    }
  });
});
