import { describe, it, expect } from 'vitest';

describe('task-router strategy_session', () => {
  it('VALID_TASK_TYPES 包含 strategy_session', async () => {
    const mod = await import('../task-router.js');
    expect(mod.VALID_TASK_TYPES).toContain('strategy_session');
  });

  it('SKILL_WHITELIST strategy_session → /strategy-session', async () => {
    const mod = await import('../task-router.js');
    expect(mod.SKILL_WHITELIST['strategy_session']).toBe('/strategy-session');
  });

  it('LOCATION_MAP strategy_session → us', async () => {
    const mod = await import('../task-router.js');
    expect(mod.LOCATION_MAP['strategy_session']).toBe('us');
  });

  it('isValidTaskType 接受 strategy_session', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('strategy_session')).toBe(true);
  });

  it('getTaskLocation strategy_session → us', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getTaskLocation('strategy_session')).toBe('us');
  });

  it('已有类型不受影响', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('dev')).toBe(true);
    expect(mod.isValidTaskType('architecture_design')).toBe(true);
    expect(mod.SKILL_WHITELIST['architecture_design']).toBe('/architect');
  });

  it('isValidTaskType 仍然拒绝未知类型', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('unknown_type')).toBe(false);
  });
});
