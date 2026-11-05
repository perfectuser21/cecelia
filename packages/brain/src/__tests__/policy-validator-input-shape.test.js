import { describe, it, expect } from 'vitest';
import { validatePolicyJson } from '../policy-validator.js';

// 直接调用无外部依赖的实际校验器；标量解析后必须走无效结果，不能逃逸为TypeError。
describe('策略JSON输入形态', () => {
  it.each(['null', '0', '-1', 'true', 'false', '""', '"policy"'])('%s解析后无效而不抛异常', input => {
    const result = validatePolicyJson(input);
    expect(result.valid).toBe(false);
    expect(result.errors).not.toHaveLength(0);
    expect(result.warnings).toEqual([]);
    expect(result.normalized).toBeNull();
  });

  it.each([null, undefined, 0, true, [], '{}', '[]', '{'])('非法形态%j保留无效封套', input => {
    const result = validatePolicyJson(input, { strict: false });
    expect(result.valid).toBe(false);
    expect(result.errors).not.toHaveLength(0);
    expect(result.normalized).toBeNull();
  });

  it.each(['requeue', 'skip', 'adjust_params', 'kill'])('合法%s策略对象与JSON字符串均保持默认归一化', action => {
    const params = { requeue: { delay_minutes: 1 }, skip: {}, adjust_params: { adjustments: {} }, kill: { reason: '人工终止' } }[action];
    const policy = { action, params, expected_outcome: '保持合法策略行为', confidence: 0.8, reasoning: '这个合法策略用于验证原有归一化合同不变' };
    const expectedParams = {
      requeue: { delay_minutes: 1, priority: 'normal' },
      skip: { reason: 'No reason provided' },
      adjust_params: { adjustments: {}, merge_strategy: 'merge' },
      kill: { reason: '人工终止' },
    }[action];
    for (const input of [policy, JSON.stringify(policy)]) {
      const result = validatePolicyJson(input);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.normalized).toEqual({ ...policy, params: expectedParams });
    }
  });
});
