/**
 * Policy Validator 完整单元测试
 *
 * 覆盖所有导出：ALLOWED_ACTIONS, ACTION_PARAMS_SCHEMA, isValidAction,
 * getRequiredParams, validatePolicyJson
 * 场景：策略验证通过、策略违反、边界条件、错误处理
 */

import { describe, it, expect } from 'vitest';
import {
  ALLOWED_ACTIONS,
  ACTION_PARAMS_SCHEMA,
  isValidAction,
  getRequiredParams,
  validatePolicyJson,
} from '../policy-validator.js';

// ─────────────────────────────────────────────
// 辅助函数：构造合法策略对象
// ─────────────────────────────────────────────
function makeValidPolicy(overrides = {}) {
  return {
    action: 'requeue',
    params: { delay_minutes: 10 },
    expected_outcome: '任务将在 10 分钟后重新排队',
    confidence: 0.8,
    reasoning: '该任务因资源不足失败，延迟后重试是最佳策略',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════
// 1. 常量导出验证
// ═══════════════════════════════════════════════
describe('常量导出', () => {
  it('ALLOWED_ACTIONS 包含 4 种动作类型', () => {
    expect(ALLOWED_ACTIONS).toEqual(['requeue', 'skip', 'adjust_params', 'kill']);
    expect(ALLOWED_ACTIONS).toHaveLength(4);
  });

  it('ACTION_PARAMS_SCHEMA 为每种动作定义了 schema', () => {
    expect(Object.keys(ACTION_PARAMS_SCHEMA)).toHaveLength(4);
    for (const action of ALLOWED_ACTIONS) {
      expect(ACTION_PARAMS_SCHEMA[action]).toBeDefined();
      expect(ACTION_PARAMS_SCHEMA[action]).toHaveProperty('required');
      expect(ACTION_PARAMS_SCHEMA[action]).toHaveProperty('optional');
      expect(ACTION_PARAMS_SCHEMA[action]).toHaveProperty('defaults');
    }
  });

  it('requeue schema 必选 delay_minutes，默认 priority=normal', () => {
    expect(ACTION_PARAMS_SCHEMA.requeue.required).toContain('delay_minutes');
    expect(ACTION_PARAMS_SCHEMA.requeue.defaults.priority).toBe('normal');
  });

  it('skip schema 无必选参数，默认 reason', () => {
    expect(ACTION_PARAMS_SCHEMA.skip.required).toHaveLength(0);
    expect(ACTION_PARAMS_SCHEMA.skip.defaults.reason).toBe('No reason provided');
  });

  it('adjust_params schema 必选 adjustments，默认 merge_strategy=merge', () => {
    expect(ACTION_PARAMS_SCHEMA.adjust_params.required).toContain('adjustments');
    expect(ACTION_PARAMS_SCHEMA.adjust_params.defaults.merge_strategy).toBe('merge');
  });

  it('kill schema 必选 reason，无默认值', () => {
    expect(ACTION_PARAMS_SCHEMA.kill.required).toContain('reason');
    expect(ACTION_PARAMS_SCHEMA.kill.defaults).toEqual({});
  });
});

// ═══════════════════════════════════════════════
// 2. isValidAction
// ═══════════════════════════════════════════════
describe('isValidAction', () => {
  it('所有允许的动作类型返回 true', () => {
    expect(isValidAction('requeue')).toBe(true);
    expect(isValidAction('skip')).toBe(true);
    expect(isValidAction('adjust_params')).toBe(true);
    expect(isValidAction('kill')).toBe(true);
  });

  it('无效动作类型返回 false', () => {
    expect(isValidAction('invalid')).toBe(false);
    expect(isValidAction('retry')).toBe(false);
    expect(isValidAction('restart')).toBe(false);
    expect(isValidAction('delete')).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isValidAction('')).toBe(false);
  });

  it('null 和 undefined 返回 false', () => {
    expect(isValidAction(null)).toBe(false);
    expect(isValidAction(undefined)).toBe(false);
  });

  it('数字类型返回 false', () => {
    expect(isValidAction(123)).toBe(false);
  });

  it('布尔类型返回 false', () => {
    expect(isValidAction(true)).toBe(false);
  });
});

// ═══════════════════════════════════════════════
// 3. getRequiredParams
// ═══════════════════════════════════════════════
describe('getRequiredParams', () => {
  it('requeue 返回 [delay_minutes]', () => {
    expect(getRequiredParams('requeue')).toEqual(['delay_minutes']);
  });

  it('skip 返回空数组', () => {
    expect(getRequiredParams('skip')).toEqual([]);
  });

  it('adjust_params 返回 [adjustments]', () => {
    expect(getRequiredParams('adjust_params')).toEqual(['adjustments']);
  });

  it('kill 返回 [reason]', () => {
    expect(getRequiredParams('kill')).toEqual(['reason']);
  });

  it('无效动作类型返回空数组', () => {
    expect(getRequiredParams('invalid')).toEqual([]);
  });

  it('undefined 返回空数组', () => {
    expect(getRequiredParams(undefined)).toEqual([]);
  });

  it('null 返回空数组', () => {
    expect(getRequiredParams(null)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════
// 4. validatePolicyJson — 输入类型处理
// ═══════════════════════════════════════════════
describe('validatePolicyJson — 输入类型处理', () => {
  it('接受对象类型的策略', () => {
    const result = validatePolicyJson(makeValidPolicy());
    expect(result.valid).toBe(true);
  });

  it('接受 JSON 字符串类型的策略', () => {
    const jsonStr = JSON.stringify(makeValidPolicy());
    const result = validatePolicyJson(jsonStr);
    expect(result.valid).toBe(true);
  });

  it('无效 JSON 字符串返回错误', () => {
    const result = validatePolicyJson('{invalid json}');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('json');
    expect(result.errors[0].message).toContain('Invalid JSON');
    expect(result.warnings).toEqual([]);
    expect(result.normalized).toBeNull();
  });

  it('null 输入返回错误', () => {
    const result = validatePolicyJson(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('input');
    expect(result.errors[0].message).toContain('object or string');
    expect(result.normalized).toBeNull();
  });

  it('undefined 输入返回错误', () => {
    const result = validatePolicyJson(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('input');
  });

  it('数字输入返回错误', () => {
    const result = validatePolicyJson(123);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('input');
  });

  it('布尔输入返回错误', () => {
    const result = validatePolicyJson(true);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('input');
  });
});

// ═══════════════════════════════════════════════
// 5. validatePolicyJson — 必填字段缺失
// ═══════════════════════════════════════════════
describe('validatePolicyJson — 必填字段缺失', () => {
  it('空对象应报告所有 5 个必填字段缺失', () => {
    const result = validatePolicyJson({});
    expect(result.valid).toBe(false);
    const fields = result.errors.map(e => e.field);
    expect(fields).toContain('action');
    expect(fields).toContain('params');
    expect(fields).toContain('expected_outcome');
    expect(fields).toContain('confidence');
    expect(fields).toContain('reasoning');
    expect(result.errors).toHaveLength(5);
    expect(result.normalized).toBeNull();
  });

  it('缺少 action 字段返回错误', () => {
    const { action, ...rest } = makeValidPolicy();
    const result = validatePolicyJson(rest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ field: 'action', message: 'Missing required field: action' });
  });

  it('缺少 params 字段返回错误', () => {
    const { params, ...rest } = makeValidPolicy();
    const result = validatePolicyJson(rest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ field: 'params', message: 'Missing required field: params' });
  });

  it('缺少 expected_outcome 字段返回错误', () => {
    const { expected_outcome, ...rest } = makeValidPolicy();
    const result = validatePolicyJson(rest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ field: 'expected_outcome', message: 'Missing required field: expected_outcome' });
  });

  it('缺少 confidence 字段返回错误', () => {
    const { confidence, ...rest } = makeValidPolicy();
    const result = validatePolicyJson(rest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ field: 'confidence', message: 'Missing required field: confidence' });
  });

  it('缺少 reasoning 字段返回错误', () => {
    const { reasoning, ...rest } = makeValidPolicy();
    const result = validatePolicyJson(rest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ field: 'reasoning', message: 'Missing required field: reasoning' });
  });

  it('缺少多个字段时报告所有缺失（提前返回）', () => {
    const result = validatePolicyJson({ action: 'skip' });
    expect(result.valid).toBe(false);
    // 必填字段缺失时提前返回，不继续后续验证
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════
// 6. validatePolicyJson — action 类型验证
// ═══════════════════════════════════════════════
describe('validatePolicyJson — action 类型验证', () => {
  it('无效 action 返回错误并包含具体动作名', () => {
    const policy = makeValidPolicy({ action: 'invalid_action' });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    const actionErr = result.errors.find(e => e.field === 'action');
    expect(actionErr).toBeDefined();
    expect(actionErr.message).toContain('invalid_action');
    expect(actionErr.message).toContain('Must be one of');
  });
});

// ═══════════════════════════════════════════════
// 7. validatePolicyJson — params 验证
// ═══════════════════════════════════════════════
describe('validatePolicyJson — params 验证', () => {
  it('params 为 null 返回错误', () => {
    const policy = makeValidPolicy({ params: null });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'params' && e.message.includes('must be an object'))).toBe(true);
  });

  it('params 为字符串返回错误', () => {
    const policy = makeValidPolicy({ params: 'not_an_object' });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'params')).toBe(true);
  });

  it('params 为数字返回错误', () => {
    const policy = makeValidPolicy({ params: 42 });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'params')).toBe(true);
  });

  // --- requeue 参数验证 ---
  it('requeue 缺少 delay_minutes 返回错误', () => {
    const policy = makeValidPolicy({ action: 'requeue', params: {} });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'params.delay_minutes')).toBe(true);
  });

  it('requeue delay_minutes 为负数返回错误', () => {
    const policy = makeValidPolicy({ params: { delay_minutes: -10 } });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'params.delay_minutes' && e.message.includes('positive'))).toBe(true);
  });

  it('requeue delay_minutes 为 0 返回错误', () => {
    const policy = makeValidPolicy({ params: { delay_minutes: 0 } });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'params.delay_minutes')).toBe(true);
  });

  it('requeue delay_minutes 为字符串返回错误', () => {
    const policy = makeValidPolicy({ params: { delay_minutes: 'not_a_number' } });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'params.delay_minutes')).toBe(true);
  });

  it('requeue priority 无效值返回错误', () => {
    const policy = makeValidPolicy({ params: { delay_minutes: 30, priority: 'invalid' } });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'params.priority')).toBe(true);
  });

  it('requeue priority 合法值 high/normal/low 通过验证', () => {
    for (const priority of ['high', 'normal', 'low']) {
      const policy = makeValidPolicy({ params: { delay_minutes: 10, priority } });
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(true);
    }
  });

  // --- kill 参数验证 ---
  it('kill 缺少 reason 返回错误', () => {
    const policy = makeValidPolicy({ action: 'kill', params: {} });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'params.reason')).toBe(true);
  });

  it('kill 有 reason 通过验证', () => {
    const policy = makeValidPolicy({
      action: 'kill',
      params: { reason: '任务反复失败需要终止' },
    });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
  });

  // --- adjust_params 参数验证 ---
  it('adjust_params 缺少 adjustments 返回错误', () => {
    const policy = makeValidPolicy({ action: 'adjust_params', params: {} });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'params.adjustments')).toBe(true);
  });

  it('adjust_params adjustments 为 null 返回错误', () => {
    const policy = makeValidPolicy({
      action: 'adjust_params',
      params: { adjustments: null },
    });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'params.adjustments' && e.message.includes('must be an object'))).toBe(true);
  });

  it('adjust_params adjustments 为字符串返回错误', () => {
    const policy = makeValidPolicy({
      action: 'adjust_params',
      params: { adjustments: 'not_object' },
    });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'params.adjustments')).toBe(true);
  });

  it('adjust_params adjustments 合法对象通过验证', () => {
    const policy = makeValidPolicy({
      action: 'adjust_params',
      params: { adjustments: { timeout: 60 } },
    });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
  });

  // --- skip 参数验证 ---
  it('skip 无必选参数，空 params 通过验证', () => {
    const policy = makeValidPolicy({ action: 'skip', params: {} });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 8. validatePolicyJson — confidence 验证
// ═══════════════════════════════════════════════
describe('validatePolicyJson — confidence 验证', () => {
  it('confidence 为字符串返回错误', () => {
    const policy = makeValidPolicy({ confidence: 'not_a_number' });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'confidence' && e.message.includes('must be a number'))).toBe(true);
  });

  it('confidence > 1 返回错误', () => {
    const policy = makeValidPolicy({ confidence: 1.5 });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'confidence' && e.message.includes('between 0 and 1'))).toBe(true);
  });

  it('confidence < 0 返回错误', () => {
    const policy = makeValidPolicy({ confidence: -0.1 });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'confidence')).toBe(true);
  });

  it('confidence = 0 在非严格模式下通过但有警告', () => {
    const policy = makeValidPolicy({ confidence: 0 });
    const result = validatePolicyJson(policy, { strict: false });
    expect(result.valid).toBe(true);
    expect(result.warnings.some(e => e.field === 'confidence' && e.message.includes('Low confidence'))).toBe(true);
  });

  it('confidence = 0 在严格模式下返回错误', () => {
    const policy = makeValidPolicy({ confidence: 0 });
    const result = validatePolicyJson(policy, { strict: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'confidence' && e.message.includes('strict mode'))).toBe(true);
  });

  it('confidence = 1 通过验证（无警告）', () => {
    const policy = makeValidPolicy({ confidence: 1 });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.warnings.filter(w => w.field === 'confidence')).toHaveLength(0);
  });

  it('confidence = 0.5 通过验证（边界值，不触发低置信度检查）', () => {
    const policy = makeValidPolicy({ confidence: 0.5 });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.errors.filter(e => e.field === 'confidence')).toHaveLength(0);
  });

  it('confidence = 0.49 在严格模式（默认）下返回错误', () => {
    const policy = makeValidPolicy({ confidence: 0.49 });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('strict mode'))).toBe(true);
  });

  it('confidence < 0.5 在非严格模式下仅产生警告', () => {
    const policy = makeValidPolicy({ confidence: 0.3 });
    const result = validatePolicyJson(policy, { strict: false });
    expect(result.valid).toBe(true);
    expect(result.warnings.some(e => e.field === 'confidence' && e.message.includes('Low confidence'))).toBe(true);
  });

  it('options.strict 默认为 true', () => {
    const policy = makeValidPolicy({ confidence: 0.3 });
    const result = validatePolicyJson(policy); // 不传 options
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('strict mode'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 9. validatePolicyJson — reasoning 验证
// ═══════════════════════════════════════════════
describe('validatePolicyJson — reasoning 验证', () => {
  it('reasoning 为非字符串返回错误', () => {
    const policy = makeValidPolicy({ reasoning: 123 });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'reasoning' && e.message.includes('must be a string'))).toBe(true);
  });

  it('reasoning 为空字符串返回错误', () => {
    const policy = makeValidPolicy({ reasoning: '' });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'reasoning' && e.message.includes('cannot be empty'))).toBe(true);
  });

  it('reasoning 为纯空白返回错误', () => {
    const policy = makeValidPolicy({ reasoning: '   ' });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'reasoning' && e.message.includes('cannot be empty'))).toBe(true);
  });

  it('reasoning 短文（< 20 字符）产生警告但通过', () => {
    const policy = makeValidPolicy({ reasoning: 'Short' });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.field === 'reasoning' && w.message.includes('short'))).toBe(true);
  });

  it('reasoning 恰好 20 字符不产生短文警告', () => {
    const policy = makeValidPolicy({ reasoning: 'A'.repeat(20) });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.field === 'reasoning' && w.message.includes('short'))).toBe(false);
  });

  it('reasoning 19 字符产生短文警告', () => {
    const policy = makeValidPolicy({ reasoning: 'A'.repeat(19) });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.field === 'reasoning' && w.message.includes('short'))).toBe(true);
  });

  it('reasoning 恰好 500 字符不产生长文警告', () => {
    const policy = makeValidPolicy({ reasoning: 'A'.repeat(500) });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.field === 'reasoning' && w.message.includes('long'))).toBe(false);
  });

  it('reasoning 501 字符产生长文警告', () => {
    const policy = makeValidPolicy({ reasoning: 'A'.repeat(501) });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.field === 'reasoning' && w.message.includes('long'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 10. validatePolicyJson — expected_outcome 验证
// ═══════════════════════════════════════════════
describe('validatePolicyJson — expected_outcome 验证', () => {
  it('expected_outcome 为非字符串返回错误', () => {
    const policy = makeValidPolicy({ expected_outcome: 123 });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'expected_outcome' && e.message.includes('must be a string'))).toBe(true);
  });

  it('expected_outcome 为空字符串返回错误', () => {
    const policy = makeValidPolicy({ expected_outcome: '' });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'expected_outcome' && e.message.includes('cannot be empty'))).toBe(true);
  });

  it('expected_outcome 为纯空白返回错误', () => {
    const policy = makeValidPolicy({ expected_outcome: '   ' });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'expected_outcome' && e.message.includes('cannot be empty'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 11. validatePolicyJson — 默认值填充（normalized）
// ═══════════════════════════════════════════════
describe('validatePolicyJson — 默认值填充', () => {
  it('requeue 自动填充 priority=normal 默认值', () => {
    const policy = makeValidPolicy({ params: { delay_minutes: 30 } });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.normalized.params.priority).toBe('normal');
    expect(result.normalized.params.delay_minutes).toBe(30);
  });

  it('skip 自动填充 reason 默认值', () => {
    const policy = makeValidPolicy({ action: 'skip', params: {} });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.normalized.params.reason).toBe('No reason provided');
  });

  it('adjust_params 自动填充 merge_strategy=merge 默认值', () => {
    const policy = makeValidPolicy({
      action: 'adjust_params',
      params: { adjustments: { foo: 'bar' } },
    });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.normalized.params.merge_strategy).toBe('merge');
  });

  it('用户指定的值不被默认值覆盖', () => {
    const policy = makeValidPolicy({ params: { delay_minutes: 5, priority: 'high' } });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.normalized.params.priority).toBe('high');
  });

  it('kill 没有默认值，normalized.params 只有用户传入的字段', () => {
    const policy = makeValidPolicy({
      action: 'kill',
      params: { reason: 'Invalid request' },
    });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(Object.keys(result.normalized.params)).toHaveLength(1);
    expect(result.normalized.params.reason).toBe('Invalid request');
  });

  it('验证失败时 normalized 为 null', () => {
    const result = validatePolicyJson({});
    expect(result.valid).toBe(false);
    expect(result.normalized).toBeNull();
  });
});

// ═══════════════════════════════════════════════
// 12. validatePolicyJson — 完整策略验证（集成场景）
// ═══════════════════════════════════════════════
describe('validatePolicyJson — 完整策略验证', () => {
  it('合法的 requeue 策略通过验证', () => {
    const result = validatePolicyJson(makeValidPolicy());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.normalized).toBeDefined();
    expect(result.normalized.action).toBe('requeue');
  });

  it('合法的 skip 策略通过验证', () => {
    const policy = makeValidPolicy({
      action: 'skip',
      params: { reason: '该任务已被手动处理' },
    });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
  });

  it('合法的 adjust_params 策略通过验证', () => {
    const policy = makeValidPolicy({
      action: 'adjust_params',
      params: { adjustments: { timeout: 120, retries: 3 }, merge_strategy: 'replace' },
    });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.normalized.params.merge_strategy).toBe('replace');
  });

  it('合法的 kill 策略（含 notify）通过验证', () => {
    const policy = makeValidPolicy({
      action: 'kill',
      params: { reason: '资源耗尽无法继续', notify: true },
    });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(true);
    expect(result.normalized.params.notify).toBe(true);
  });

  it('多个字段错误同时报告', () => {
    const policy = makeValidPolicy({
      action: 'invalid',
      params: null,
      confidence: 'not_a_number',
      reasoning: 42,
      expected_outcome: false,
    });
    const result = validatePolicyJson(policy);
    expect(result.valid).toBe(false);
    // action、params、confidence、reasoning、expected_outcome 都有错
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it('JSON 字符串输入也能正确填充默认值', () => {
    const policy = makeValidPolicy({ action: 'skip', params: {} });
    const jsonStr = JSON.stringify(policy);
    const result = validatePolicyJson(jsonStr);
    expect(result.valid).toBe(true);
    expect(result.normalized.params.reason).toBe('No reason provided');
  });

  it('返回结构始终包含 valid/errors/warnings/normalized 四个字段', () => {
    // 成功场景
    const successResult = validatePolicyJson(makeValidPolicy());
    expect(successResult).toHaveProperty('valid');
    expect(successResult).toHaveProperty('errors');
    expect(successResult).toHaveProperty('warnings');
    expect(successResult).toHaveProperty('normalized');

    // 失败场景 — 无效输入
    const failResult = validatePolicyJson(null);
    expect(failResult).toHaveProperty('valid');
    expect(failResult).toHaveProperty('errors');
    expect(failResult).toHaveProperty('warnings');
    expect(failResult).toHaveProperty('normalized');

    // 失败场景 — 无效 JSON
    const jsonFailResult = validatePolicyJson('{bad}');
    expect(jsonFailResult).toHaveProperty('valid');
    expect(jsonFailResult).toHaveProperty('errors');
    expect(jsonFailResult).toHaveProperty('warnings');
    expect(jsonFailResult).toHaveProperty('normalized');
  });

  it('warnings 在验证通过时也能正确返回', () => {
    const policy = makeValidPolicy({
      confidence: 0.3,
      reasoning: 'Short',
    });
    // 非严格模式下 confidence < 0.5 是 warning，reasoning < 20 也是 warning
    const result = validatePolicyJson(policy, { strict: false });
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    expect(result.warnings.some(w => w.field === 'confidence')).toBe(true);
    expect(result.warnings.some(w => w.field === 'reasoning')).toBe(true);
  });
});
