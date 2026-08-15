import { describe, expect, it } from 'vitest';

import { normalizeEvaluatorBrainResult } from './evaluator-brain-result.js';

describe('normalizeEvaluatorBrainResult', () => {
  it('保留人工验收证据并把可信断言回执转为行为测试', () => {
    const result = normalizeEvaluatorBrainResult({
      decision: { outcome: 'FAIL' },
      summary: '发现真实产品缺陷',
      findings: [{ severity: 'P1', title: '保存失败' }],
      screenshots: [{ path: '/evidence/save.png' }],
      exploration_notes: ['按用户路径进行了保存操作'],
      checks: [{
        assertion_id: 'save-persists',
        command_argv: ['node', 'verify-save.mjs'],
        output_tail: 'expected persisted row',
      }],
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.findings).toHaveLength(1);
    expect(result.screenshots).toHaveLength(1);
    expect(result.exploration_notes).toHaveLength(1);
    expect(result.behavior_tests[0]).toMatchObject({
      command: 'required_assertion:save-persists argv:["node","verify-save.mjs"]',
      log_tail: 'expected persisted row',
    });
  });

  it('已归一结果保持原身份', () => {
    const result = { verdict: 'PASS', behavior_tests: [] };
    expect(normalizeEvaluatorBrainResult(result)).toBe(result);
  });
});
