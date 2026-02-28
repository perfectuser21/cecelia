import { describe, it, expect } from 'vitest';

describe('task-router suggestion_plan', () => {
  it('D2: VALID_TASK_TYPES 包含 suggestion_plan', async () => {
    const mod = await import('../task-router.js');
    expect(mod.VALID_TASK_TYPES).toContain('suggestion_plan');
  });

  it('D2: SKILL_WHITELIST suggestion_plan → /plan', async () => {
    const mod = await import('../task-router.js');
    expect(mod.SKILL_WHITELIST['suggestion_plan']).toBe('/plan');
  });

  it('D2: LOCATION_MAP suggestion_plan → us', async () => {
    const mod = await import('../task-router.js');
    expect(mod.LOCATION_MAP['suggestion_plan']).toBe('us');
  });

  it('D2: isValidTaskType 接受 suggestion_plan', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('suggestion_plan')).toBe(true);
  });

  it('D2: getTaskLocation suggestion_plan → us', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getTaskLocation('suggestion_plan')).toBe('us');
  });

  it('D2: 已有类型不受影响', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('dev')).toBe(true);
    expect(mod.isValidTaskType('initiative_plan')).toBe(true);
    expect(mod.isValidTaskType('decomp_review')).toBe(true);
  });

  it('D2: isValidTaskType 仍然拒绝未知类型', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('unknown_type')).toBe(false);
  });
});
