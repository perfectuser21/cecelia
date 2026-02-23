/**
 * Test: executor.js getSkillForTaskType payload.decomposition 路由增强
 *
 * DoD 映射：
 * - payload.decomposition === true + task_type === 'dev' → /dev（显式保留）
 * - payload.decomposition === 'exploratory' → /exploratory（探索性验证任务）
 * - payload.decomposition === 'okr' → /okr（OKR 拆解任务）
 * - payload.next_action === 'decompose' → /okr（继续拆解）
 * - payload.decomposition === 'known' → 原有 taskType 路由
 * - 无 payload → 向后兼容，原有 taskType 路由
 * - task_type: 'exploratory' → /exploratory（回归）
 */

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

describe('getSkillForTaskType: payload.decomposition 路由增强', () => {
  let getSkillForTaskType;

  beforeEach(async () => {
    const executor = await import('../executor.js');
    getSkillForTaskType = executor.getSkillForTaskType;
  });

  // DoD-1: payload.decomposition === true + task_type === 'dev' → /dev（显式保留）
  it('payload.decomposition=true + task_type=dev 应路由到 /dev', () => {
    const result = getSkillForTaskType('dev', { decomposition: true });
    expect(result).toBe('/dev');
  });

  // DoD-3: payload.decomposition === 'okr' → /okr（OKR 拆解任务）
  it('payload.decomposition=okr 应路由到 /okr', () => {
    const result = getSkillForTaskType('dev', { decomposition: 'okr' });
    expect(result).toBe('/okr');
  });

  // DoD-5: payload.next_action === 'decompose' → /okr（PR #370 回归）
  it('payload.next_action=decompose 应路由到 /okr', () => {
    const result = getSkillForTaskType('dev', { next_action: 'decompose' });
    expect(result).toBe('/okr');
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

  // DoD-6: getSkillForTaskType 已导出（本测试能 import 即证明）
  it('getSkillForTaskType 应已导出', () => {
    expect(typeof getSkillForTaskType).toBe('function');
  });

  // 额外回归：其他 taskType 不受影响
  it('task_type=review 无 payload 时应路由到 /review', () => {
    const result = getSkillForTaskType('review');
    expect(result).toBe('/review');
  });

  it('task_type=talk 无 payload 时应路由到 /talk', () => {
    const result = getSkillForTaskType('talk');
    expect(result).toBe('/talk');
  });

  // payload.next_action === 'decompose' 优先于 decomposition === 'known'
  it('next_action=decompose 优先于 decomposition=known', () => {
    const result = getSkillForTaskType('dev', {
      decomposition: 'known',
      next_action: 'decompose'
    });
    // decomposition='known' 不触发特判，next_action='decompose' → /okr
    expect(result).toBe('/okr');
  });

  // next_action !== 'decompose' → 不触发 /okr
  it('payload.next_action 不是 decompose 时不路由到 /okr', () => {
    const result = getSkillForTaskType('dev', { next_action: 'continue' });
    expect(result).toBe('/dev');
  });

});
