/**
 * Thalamus write_self_model action 移除验证。
 *
 * 背景：write_self_model 在 ACTION_WHITELIST 中暴露给 LLM，但无 handler，
 * 是潜在攻击面（Haiku 角色混淆事件 learning_id=f63cf8e8）。
 * 修复：从 ACTION_WHITELIST 移除，让 validateDecision 直接拒绝。
 */

import { describe, it, expect } from 'vitest';
import { validateDecision, ACTION_WHITELIST } from '../thalamus.js';

describe('write_self_model 已从 ACTION_WHITELIST 移除', () => {
  it('ACTION_WHITELIST 不再包含 write_self_model', () => {
    expect(ACTION_WHITELIST.write_self_model).toBeUndefined();
  });

  it('validateDecision 拒绝 write_self_model action', () => {
    const decision = {
      level: 1,
      actions: [{ type: 'write_self_model', params: { content: 'evil' } }],
      rationale: 'Haiku 试图自我修改',
      confidence: 0.9,
      safety: false,
    };
    const result = validateDecision(decision);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('write_self_model');
    expect(result.errors.join(' ')).toContain('不在白名单内');
  });

  it('合法 action（log_event）仍然通过', () => {
    const decision = {
      level: 0,
      actions: [{ type: 'log_event', params: { event_type: 'test' } }],
      rationale: '合法操作',
      confidence: 0.9,
      safety: false,
    };
    const result = validateDecision(decision);
    expect(result.valid).toBe(true);
  });
});
