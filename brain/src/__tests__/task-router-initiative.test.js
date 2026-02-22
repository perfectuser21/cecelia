/**
 * Task Router - initiative_plan / initiative_verify 路由测试
 *
 * DoD 覆盖: D3
 */

import { describe, it, expect } from 'vitest';

describe('task-router initiative types', () => {
  it('D3: LOCATION_MAP initiative_plan → us', async () => {
    const mod = await import('../task-router.js');
    expect(mod.LOCATION_MAP['initiative_plan']).toBe('us');
    expect(mod.getTaskLocation('initiative_plan')).toBe('us');
  });

  it('D3: LOCATION_MAP initiative_verify → us', async () => {
    const mod = await import('../task-router.js');
    expect(mod.LOCATION_MAP['initiative_verify']).toBe('us');
    expect(mod.getTaskLocation('initiative_verify')).toBe('us');
  });

  it('D3: isValidTaskType accepts initiative_plan', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('initiative_plan')).toBe(true);
  });

  it('D3: isValidTaskType accepts initiative_verify', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('initiative_verify')).toBe(true);
  });

  it('D3: getValidTaskTypes includes new types', async () => {
    const mod = await import('../task-router.js');
    const types = mod.getValidTaskTypes();
    expect(types).toContain('initiative_plan');
    expect(types).toContain('initiative_verify');
  });

  it('existing types still work correctly', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getTaskLocation('dev')).toBe('us');
    expect(mod.getTaskLocation('decomp_review')).toBe('hk');
    expect(mod.getTaskLocation('talk')).toBe('hk');
    expect(mod.isValidTaskType('dev')).toBe(true);
    expect(mod.isValidTaskType('exploratory')).toBe(true);
    expect(mod.isValidTaskType('codex_qa')).toBe(true);
  });
});
