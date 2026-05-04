import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 所有 LLM 依赖，模拟超时场景（用 importOriginal 保留其他导出）
vi.mock('../../thalamus.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    processEvent: vi.fn(() => new Promise(resolve => setTimeout(() => resolve({ actions: [] }), 35000))),
  };
});
vi.mock('../../planner.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    planNextTask: vi.fn(() => new Promise(resolve => setTimeout(() => resolve({ planned: false }), 35000))),
  };
});
vi.mock('../../rumination.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runRumination: vi.fn(() => new Promise(resolve => setTimeout(() => resolve({}), 35000))),
  };
});

describe('tick-runner deblock', () => {
  it('thalamusProcessEvent 超时 30s 后返回 fallback，不阻塞', async () => {
    const start = Date.now();
    // 直接测试 withThalamusTimeout 函数（Task 1A 要导出）
    const { withThalamusTimeout } = await import('../../tick-runner.js');
    const result = await withThalamusTimeout(
      new Promise(resolve => setTimeout(() => resolve({ actions: [{ type: 'dispatch_task' }] }), 35000)),
      30000
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(31000);
    expect(result.actions[0].type).toBe('fallback_to_tick');
  }, 35000);
});
