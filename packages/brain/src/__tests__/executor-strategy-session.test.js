/**
 * executor-strategy-session.test.js
 *
 * DoD:
 * - getSkillForTaskType('strategy_session') → '/strategy-session'
 * - getValidTaskTypes() 包含 'strategy_session'
 * - getTaskLocation('strategy_session') → 'us'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '')
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn()
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0')
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn()
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { SUCCESS: 'success', FAILED: 'failed' },
  EXECUTOR_HOSTS: { US_VPS: 'us' }
}));

describe('executor getSkillForTaskType — strategy_session', () => {
  let getSkillForTaskType;

  beforeEach(async () => {
    vi.resetModules();
    const executor = await import('../executor.js');
    getSkillForTaskType = executor.getSkillForTaskType;
  });

  it('strategy_session → /strategy-session', () => {
    expect(getSkillForTaskType('strategy_session')).toBe('/strategy-session');
  });

  it('dev 仍然 → /dev（回归）', () => {
    expect(getSkillForTaskType('dev')).toBe('/dev');
  });

  it('architecture_design 仍然 → /architect（回归）', () => {
    expect(getSkillForTaskType('architecture_design')).toBe('/architect');
  });
});

describe('task-router strategy_session 路由', () => {
  let getValidTaskTypes, getTaskLocation;

  beforeEach(async () => {
    vi.resetModules();
    const router = await import('../task-router.js');
    getValidTaskTypes = router.getValidTaskTypes;
    getTaskLocation = router.getTaskLocation;
  });

  it('getValidTaskTypes 包含 strategy_session', () => {
    expect(getValidTaskTypes()).toContain('strategy_session');
  });

  it('getTaskLocation(strategy_session) → us', () => {
    expect(getTaskLocation('strategy_session')).toBe('us');
  });
});
