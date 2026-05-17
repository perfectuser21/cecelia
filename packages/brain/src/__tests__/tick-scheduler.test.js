// packages/brain/src/__tests__/tick-scheduler.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 所有外部依赖
const mockGetGuidance = vi.fn();
const mockIsAllowed = vi.fn();
const mockDispatchNextTask = vi.fn();
const mockQuery = vi.fn();

vi.mock('../guidance.js', () => ({
  getGuidance: (...args) => mockGetGuidance(...args),
}));

vi.mock('../circuit-breaker.js', () => ({
  isAllowed: (...args) => mockIsAllowed(...args),
}));

vi.mock('../dispatcher.js', () => ({
  dispatchNextTask: (...args) => mockDispatchNextTask(...args),
}));

vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

// 文件未创建时这行会 fail — 这就是"失败测试"的意义
import { runScheduler, EXECUTOR_ROUTING } from '../tick-scheduler.js';

describe('tick-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：circuit breaker CLOSED（允许派发）
    mockIsAllowed.mockReturnValue(true);
    // 默认：无 guidance 建议
    mockGetGuidance.mockResolvedValue(null);
    // 默认：有活跃 KR
    mockQuery.mockResolvedValue({ rows: [{ id: 'kr-1' }, { id: 'kr-2' }] });
    // 默认：dispatch 成功
    mockDispatchNextTask.mockResolvedValue({ dispatched: true, actions: [], reason: 'ok' });
  });

  // 测试 1: 有 guidance 建议时 guidance_found=true
  it('有 guidance 建议时 guidance_found=true', async () => {
    mockGetGuidance.mockResolvedValue({ executor_type: 'codex' });
    const result = await runScheduler();
    // guidance 被读取（strategy:global key）
    expect(mockGetGuidance).toHaveBeenCalledWith('strategy:global');
    // 调度仍然执行
    expect(mockDispatchNextTask).toHaveBeenCalled();
    expect(result.guidance_found).toBe(true);
  });

  // 测试 2: 无 guidance 时用 EXECUTOR_ROUTING 默认路由（路由表存在且完整）
  it('EXECUTOR_ROUTING 包含所有核心任务类型', () => {
    expect(EXECUTOR_ROUTING).toMatchObject({
      dev_task: 'cecelia_bridge',
      code_review: 'cecelia_bridge',
      arch_review: 'cecelia_bridge',
      research: 'cecelia_bridge',
      harness: 'cecelia_bridge',
    });
  });

  // 测试 3: circuit breaker OPEN 时跳过派发
  it('circuit breaker OPEN 时不调用 dispatchNextTask', async () => {
    mockIsAllowed.mockReturnValue(false);
    const result = await runScheduler();
    expect(mockDispatchNextTask).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('circuit_open');
  });

  // 测试 4: 整个 runScheduler() < 500ms（mock 所有 DB 调用）
  it('runScheduler 完成时间 < 500ms（全 mock）', async () => {
    const start = Date.now();
    await runScheduler();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  // 测试 5: 绝对没有 await thalamusProcessEvent / await generateDecision 调用
  it('runScheduler 源码不含 thalamusProcessEvent 或 generateDecision 字符串', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      new URL('../tick-scheduler.js', import.meta.url),
      'utf8'
    );
    expect(src).not.toContain('thalamusProcessEvent');
    expect(src).not.toContain('generateDecision');
    expect(src).not.toContain('runRumination');
    expect(src).not.toContain('planNextTask');
  });
});
