import { describe, it, expect } from 'vitest';

describe('task-router strategy_session', () => {
  it('D1: VALID_TASK_TYPES 包含 strategy_session', async () => {
    const mod = await import('../task-router.js');
    expect(mod.VALID_TASK_TYPES).toContain('strategy_session');
  });

  it('D2: SKILL_WHITELIST strategy_session → /strategy-session', async () => {
    const mod = await import('../task-router.js');
    expect(mod.SKILL_WHITELIST['strategy_session']).toBe('/strategy-session');
  });

  it('D3: LOCATION_MAP strategy_session → us', async () => {
    const mod = await import('../task-router.js');
    expect(mod.LOCATION_MAP['strategy_session']).toBe('us');
  });

  it('D4: isValidTaskType 接受 strategy_session', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('strategy_session')).toBe(true);
  });

  it('D5: getTaskLocation strategy_session → us', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getTaskLocation('strategy_session')).toBe('us');
  });

  it('D6: routeTaskCreate strategy_session 路由正确', async () => {
    const mod = await import('../task-router.js');
    const routing = mod.routeTaskCreate({ task_type: 'strategy_session', title: '战略会议' });
    expect(routing.location).toBe('us');
    expect(routing.skill).toBe('/strategy-session');
    expect(routing.task_type).toBe('strategy_session');
  });

  it('D7: 已有类型不受影响', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('dev')).toBe(true);
    expect(mod.isValidTaskType('architecture_design')).toBe(true);
    expect(mod.isValidTaskType('initiative_plan')).toBe(true);
  });

  it('D8: isValidTaskType 仍然拒绝未知类型', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('unknown_type')).toBe(false);
  });
});
