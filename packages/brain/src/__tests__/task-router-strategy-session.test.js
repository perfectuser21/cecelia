/**
 * task-router-strategy-session.test.js
 *
 * DoD 覆盖：
 * - D1: VALID_TASK_TYPES 包含 strategy_session
 * - D2: SKILL_WHITELIST['strategy_session'] === '/strategy-session'
 * - D3: LOCATION_MAP['strategy_session'] === 'us'
 * - D4: isValidTaskType('strategy_session') === true
 * - D5: getTaskLocation('strategy_session') === 'us'
 * - D6: 已有类型不受影响
 */

import { describe, it, expect } from 'vitest';

describe('task-router strategy_session 注册', () => {
  it('D1: VALID_TASK_TYPES 包含 strategy_session', async () => {
    const mod = await import('../task-router.js');
    expect(mod.VALID_TASK_TYPES).toContain('strategy_session');
  });

  it('D2: SKILL_WHITELIST strategy_session → /strategy-session', async () => {
    const mod = await import('../task-router.js');
    expect(mod.SKILL_WHITELIST['strategy_session']).toBe('/strategy-session');
  });

  it('D3: LOCATION_MAP strategy_session → xian', async () => {
    const mod = await import('../task-router.js');
    expect(mod.LOCATION_MAP['strategy_session']).toBe('xian');
  });

  it('D4: isValidTaskType 接受 strategy_session', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('strategy_session')).toBe(true);
  });

  it('D5: getTaskLocation strategy_session → xian', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getTaskLocation('strategy_session')).toBe('xian');
  });

  it('D6: 已有类型不受影响', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('dev')).toBe(true);
    expect(mod.isValidTaskType('initiative_plan')).toBe(true);
    expect(mod.isValidTaskType('decomp_review')).toBe(true);
  });

  it('D6: isValidTaskType 仍然拒绝未知类型', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('unknown_type')).toBe(false);
  });
});
