/**
 * task-router-intent-cto.test.js
 *
 * Pipeline v2 改造后更新：
 * - cto_review 已删除（被 Codex Gate 替代）
 * - 保留 intent_expand 注册验证
 * - 新增 initiative_execute 注册验证
 * - 验证旧类型已被清理
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

describe('task-router initiative_execute 注册', () => {
  it('VALID_TASK_TYPES 包含 initiative_execute', async () => {
    const mod = await import('../task-router.js');
    expect(mod.VALID_TASK_TYPES).toContain('initiative_execute');
  });

  it('SKILL_WHITELIST initiative_execute → /dev', async () => {
    const mod = await import('../task-router.js');
    expect(mod.SKILL_WHITELIST['initiative_execute']).toBe('/dev');
  });

  it('LOCATION_MAP initiative_execute → us', async () => {
    const mod = await import('../task-router.js');
    expect(mod.LOCATION_MAP['initiative_execute']).toBe('us');
  });

  it('isValidTaskType 接受 initiative_execute', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('initiative_execute')).toBe(true);
  });

  it('getTaskLocation initiative_execute → us', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getTaskLocation('initiative_execute')).toBe('us');
  });
});

describe('Pipeline v2 旧类型已清理', () => {
  it('cto_review 已从 VALID_TASK_TYPES 删除', async () => {
    const mod = await import('../task-router.js');
    expect(mod.VALID_TASK_TYPES).not.toContain('cto_review');
  });

  it('code_quality_review 已从 VALID_TASK_TYPES 删除', async () => {
    const mod = await import('../task-router.js');
    expect(mod.VALID_TASK_TYPES).not.toContain('code_quality_review');
  });

  it('prd_coverage_audit 已从 VALID_TASK_TYPES 删除', async () => {
    const mod = await import('../task-router.js');
    expect(mod.VALID_TASK_TYPES).not.toContain('prd_coverage_audit');
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

describe('model-registry intent_expand agent 注册', () => {
  it('D7: AGENTS 包含 intent_expand agent', async () => {
    const mod = await import('../model-registry.js');
    const agent = mod.AGENTS.find(a => a.id === 'intent_expand');
    expect(agent).toBeDefined();
    expect(agent.layer).toBe('executor');
    expect(agent.allowed_models).toContain('claude-sonnet-4-6');
  });
});
