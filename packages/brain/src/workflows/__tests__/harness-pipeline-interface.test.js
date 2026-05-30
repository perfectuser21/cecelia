/**
 * harness-pipeline-interface.test.js — harness pipeline 接口约定回归测试
 *
 * 验证 SKILL↔Brain 跨边界接口约定（Brain registry type=harness_interface）：
 *  1. RUBRIC_DIMENSIONS 必须 7 个（对齐 reviewer SKILL v6.4.0+）
 *  2. thresholdForRound 任意 round 返回 7（reviewer SKILL: 单轮阈值固定 7）
 *  3. computeVerdictFromRubric 覆盖全部 7 维度才 APPROVED
 */
import { describe, it, expect } from 'vitest';
import {
  thresholdForRound,
  computeVerdictFromRubric,
} from '../harness-gan.graph.js';

const ALL_7_DIMS = [
  'dod_machineability',
  'scope_match_prd',
  'test_is_red',
  'internal_consistency',
  'risk_registered',
  'verification_oracle_completeness',
  'ci_workflow_alignment',
];

describe('harness::rubric-dimensions 接口约定 [BEHAVIOR]', () => {
  it('thresholdForRound — 任意 round 固定返回 7（reviewer SKILL v6.4.0+ 单轮阈值固定 7）', () => {
    expect(thresholdForRound(1)).toBe(7);
    expect(thresholdForRound(2)).toBe(7);
    expect(thresholdForRound(3)).toBe(7); // 修复前此处返回 6
    expect(thresholdForRound(10)).toBe(7);
  });

  it('computeVerdictFromRubric — 7 维度全部 >=7 → APPROVED', () => {
    const scores = Object.fromEntries(ALL_7_DIMS.map((k) => [k, 7]));
    expect(computeVerdictFromRubric(scores, 1)).toBe('APPROVED');
    expect(computeVerdictFromRubric(scores, 3)).toBe('APPROVED');
  });

  it('computeVerdictFromRubric — 缺少 verification_oracle_completeness 或 ci_workflow_alignment → null（维度不完整）', () => {
    // 修复前只有 5 维度，缺这两个维度仍能打分 → 分数虚高
    // 修复后 7 维度都必须有，缺一 → null
    const only5 = Object.fromEntries(ALL_7_DIMS.slice(0, 5).map((k) => [k, 7]));
    expect(computeVerdictFromRubric(only5, 1)).toBeNull();
  });

  it('computeVerdictFromRubric — 任一维度 <7 → REVISION', () => {
    const scores = Object.fromEntries(ALL_7_DIMS.map((k) => [k, 7]));
    scores.verification_oracle_completeness = 6;
    expect(computeVerdictFromRubric(scores, 1)).toBe('REVISION');
  });
});
