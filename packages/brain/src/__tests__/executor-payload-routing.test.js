/** 现役任务的普通技能路由；旧拆解只由executor-retired-decomposition验证拒绝启动。 */
import { describe, it, expect, vi } from 'vitest';

// Mock 所有 executor.js 的外部依赖
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
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

vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us')
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn()
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { EXECUTOR: 'executor' },
  STATUS: { START: 'start', SUCCESS: 'success' },
  EXECUTOR_HOSTS: { US: 'us', HK: 'hk' }
}));

describe('getSkillForTaskType: 现役普通任务路由', () => {
  let getSkillForTaskType;

  beforeEach(async () => {
    const executor = await import('../executor.js');
    getSkillForTaskType = executor.getSkillForTaskType;
  });

  // DoD-4: payload.decomposition === 'known' → 原有路由
  it('payload.decomposition=known 应保持原有 taskType 路由', () => {
    const result = getSkillForTaskType('dev', { decomposition: 'known' });
    expect(result).toBe('/dev');
  });

  // DoD-4: 无 payload → 向后兼容
  it('无 payload 参数时应向后兼容，返回 /dev', () => {
    const result = getSkillForTaskType('dev');
    expect(result).toBe('/dev');
  });

  // DoD-4 extra: 空 payload → 向后兼容
  it('空 payload 对象时应走 taskType 原有路由', () => {
    const result = getSkillForTaskType('dev', {});
    expect(result).toBe('/dev');
  });

  // 额外回归：其他 taskType 不受影响
  it('task_type=review 无 payload 时应路由到 /code-review', () => {
    const result = getSkillForTaskType('review');
    expect(result).toBe('/code-review');
  });

  it('task_type=talk 无 payload 时应路由到 /talk', () => {
    const result = getSkillForTaskType('talk');
    expect(result).toBe('/talk');
  });

  // next_action !== 'decompose' → 不触发 /decomp
  it('payload.next_action=continue保持普通dev路由', () => {
    const result = getSkillForTaskType('dev', { next_action: 'continue' });
    expect(result).toBe('/dev');
  });

});
