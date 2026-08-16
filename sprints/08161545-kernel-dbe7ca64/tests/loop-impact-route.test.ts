/**
 * 冻结合同测试 — loop.js 确定性 impact 出口路由
 *
 * 被改的边（禁 mock）：loop.js 的 DETERMINISTIC_IMPACT_ERROR_CODES 集合 +
 * routeDeterministicImpact 路由函数（本 sprint 新增导出）。两者均真实执行，不 mock。
 * 当前代码未导出这两个符号 → 本文件现为 RED（TypeError/undefined）。
 *
 * 动作字面量以系统既有常量为准：spawn:generator-fix（连字符，见 derive.js）、
 * wait:human_review。
 */
import { describe, it, expect } from 'vitest';
import {
  routeDeterministicImpact,
  DETERMINISTIC_IMPACT_ERROR_CODES,
} from '../../../packages/brain/src/orchestrator/loop.js';

describe('loop 确定性 impact 出口路由', () => {
  it('DETERMINISTIC_IMPACT_ERROR_CODES 覆盖新确定性 reason', () => {
    for (const code of [
      'impact_anchor_missing',
      'capability_assertion_coverage_missing',
      'capability_not_in_active_projection',
      'unsafe_assertion_ref',
      'assertion_identity_ambiguous',
      'mapper_contract_invalid',
    ]) {
      expect(DETERMINISTIC_IMPACT_ERROR_CODES.has(code)).toBe(true);
    }
  });

  it('impact_anchor_missing retryable false 首次路由到 spawn generator-fix 带 unclaimed_files', () => {
    const d = routeDeterministicImpact({
      reason: 'impact_anchor_missing',
      retryable: false,
      detail: { unclaimed_files: ['DoD.md'] },
      priorGeneratorFix: false,
    });
    expect(d.action).toBe('spawn:generator-fix');
    expect(d.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('impact_anchor_missing 二次仍失败收敛到 wait human_review', () => {
    const d = routeDeterministicImpact({
      reason: 'impact_anchor_missing',
      retryable: false,
      detail: { unclaimed_files: ['DoD.md'] },
      priorGeneratorFix: true,
    });
    expect(d.action).toBe('wait:human_review');
  });

  it('capability_assertion_coverage_missing 直接路由到 wait human_review', () => {
    const d = routeDeterministicImpact({
      reason: 'capability_assertion_coverage_missing',
      retryable: false,
      detail: { capability_ids: ['G1'] },
      priorGeneratorFix: false,
    });
    expect(d.action).toBe('wait:human_review');
  });

  it('retryable true 的真新鲜度结论不走确定性出口', () => {
    const d = routeDeterministicImpact({
      reason: 'mapper_stale',
      retryable: true,
    });
    expect(d).toBeNull();
  });
});
