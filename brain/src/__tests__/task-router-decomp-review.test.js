/**
 * Task Router - decomp_review 路由测试
 *
 * DoD 覆盖: D8
 */

import { describe, it, expect } from 'vitest';

describe('task-router decomp_review', () => {
  it('D8: LOCATION_MAP 包含 decomp_review → hk', async () => {
    const mod = await import('../task-router.js');
    expect(mod.LOCATION_MAP['decomp_review']).toBe('hk');
    expect(mod.getTaskLocation('decomp_review')).toBe('hk');
  });

  it('D8: isValidTaskType 接受 decomp_review', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('decomp_review')).toBe(true);
  });

  it('已有类型仍然正常工作', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getTaskLocation('dev')).toBe('us');
    expect(mod.getTaskLocation('talk')).toBe('hk');
    expect(mod.isValidTaskType('dev')).toBe(true);
    expect(mod.isValidTaskType('research')).toBe(true);
  });
});
