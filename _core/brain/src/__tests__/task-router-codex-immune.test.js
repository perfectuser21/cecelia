import { describe, it, expect } from 'vitest';

// task-router.js 的 LOCATION_MAP 和 isValidTaskType
// 通过直接引用模块测试

describe('task-router codex_qa', () => {
  it('D1: LOCATION_MAP 包含 codex_qa → us', async () => {
    const mod = await import('../task-router.js');
    const location = mod.getTaskLocation('codex_qa');
    expect(location).toBe('us');
  });

  it('D2: isValidTaskType 接受 codex_qa', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('codex_qa')).toBe(true);
  });

  it('D2: isValidTaskType 仍然接受已有类型', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('dev')).toBe(true);
    expect(mod.isValidTaskType('qa')).toBe(true);
    expect(mod.isValidTaskType('review')).toBe(true);
  });

  it('D2: isValidTaskType 拒绝未知类型', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('unknown_type')).toBe(false);
  });
});
