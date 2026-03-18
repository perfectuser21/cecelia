/**
 * task-router-intent-cto.test.js
 *
 * DoD 覆盖：
 * - D1: VALID_TASK_TYPES 包含 intent_expand 和 cto_review
 * - D2: SKILL_WHITELIST 映射正确（intent_expand→/intent-expand, cto_review→/cto-review）
 * - D3: LOCATION_MAP 映射正确（intent_expand→us, cto_review→xian）
 * - D4: isValidTaskType 接受两种新类型
 * - D5: getTaskLocation 返回正确位置
 * - D6: 已有类型不受影响
 * - D7: model-registry AGENTS 包含两个新 agent
 */

import { describe, it, expect } from 'vitest';

describe('task-router intent_expand 注册', () => {
  it('D1: VALID_TASK_TYPES 包含 intent_expand', async () => {
    const mod = await import('../task-router.js');
    expect(mod.VALID_TASK_TYPES).toContain('intent_expand');
  });

  it('D2: SKILL_WHITELIST intent_expand → /intent-expand', async () => {
    const mod = await import('../task-router.js');
    expect(mod.SKILL_WHITELIST['intent_expand']).toBe('/intent-expand');
  });

  it('D3: LOCATION_MAP intent_expand → us（本机执行，查本地 Brain DB）', async () => {
    const mod = await import('../task-router.js');
    expect(mod.LOCATION_MAP['intent_expand']).toBe('us');
  });

  it('D4: isValidTaskType 接受 intent_expand', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('intent_expand')).toBe(true);
  });

  it('D5: getTaskLocation intent_expand → us', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getTaskLocation('intent_expand')).toBe('us');
  });
});

describe('task-router cto_review 注册', () => {
  it('D1: VALID_TASK_TYPES 包含 cto_review', async () => {
    const mod = await import('../task-router.js');
    expect(mod.VALID_TASK_TYPES).toContain('cto_review');
  });

  it('D2: SKILL_WHITELIST cto_review → /cto-review', async () => {
    const mod = await import('../task-router.js');
    expect(mod.SKILL_WHITELIST['cto_review']).toBe('/cto-review');
  });

  it('D3: LOCATION_MAP cto_review → xian（西安 Codex 独立审查）', async () => {
    const mod = await import('../task-router.js');
    expect(mod.LOCATION_MAP['cto_review']).toBe('xian');
  });

  it('D4: isValidTaskType 接受 cto_review', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('cto_review')).toBe(true);
  });

  it('D5: getTaskLocation cto_review → xian', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getTaskLocation('cto_review')).toBe('xian');
  });
});

describe('task-router 已有类型不受影响', () => {
  it('D6: dev/pr_review/strategy_session 等已有类型不变', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('dev')).toBe(true);
    expect(mod.isValidTaskType('pr_review')).toBe(true);
    expect(mod.isValidTaskType('strategy_session')).toBe(true);
    expect(mod.LOCATION_MAP['dev']).toBe('us');
    expect(mod.LOCATION_MAP['pr_review']).toBe('xian');
  });

  it('D6: 未知类型仍然被拒绝', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('unknown_type')).toBe(false);
    expect(mod.isValidTaskType('local_expand')).toBe(false);
  });
});

describe('model-registry intent_expand + cto_review agent 注册', () => {
  it('D7: AGENTS 包含 intent_expand agent', async () => {
    const mod = await import('../model-registry.js');
    const agent = mod.AGENTS.find(a => a.id === 'intent_expand');
    expect(agent).toBeDefined();
    expect(agent.layer).toBe('executor');
    expect(agent.allowed_models).toContain('claude-sonnet-4-6');
  });

  it('D7: AGENTS 包含 cto_review agent', async () => {
    const mod = await import('../model-registry.js');
    const agent = mod.AGENTS.find(a => a.id === 'cto_review');
    expect(agent).toBeDefined();
    expect(agent.layer).toBe('executor');
    expect(agent.fixed_provider).toBe('openai');
    expect(agent.allowed_models).toContain('codex-mini-latest');
  });
});
